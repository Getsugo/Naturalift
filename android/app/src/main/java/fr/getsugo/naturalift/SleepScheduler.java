package fr.getsugo.naturalift;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Rappel de coucher.
 *
 * Lit le prochain réveil du téléphone (AlarmManager.getNextAlarmClock, rempli par
 * l'appli Horloge), calcule l'heure de coucher :
 *     coucher = réveil − durée de sommeil voulue − temps d'endormissement
 * et planifie une notification « rappel » quelques minutes avant.
 *
 * Une vérification toutes les heures (inexacte, économe en batterie) replanifie
 * le rappel si le réveil a changé.
 */
public final class SleepScheduler {

    static final String ACTION_REMIND = "fr.getsugo.naturalift.REMIND";
    static final String ACTION_CHECK = "fr.getsugo.naturalift.CHECK";

    private static final String PREFS = "sleep";
    private static final String CHANNEL_ID = "coucher";
    private static final int NOTIF_ID = 42;
    private static final int RC_REMIND = 1;
    private static final int RC_CHECK = 2;

    // Valeurs par défaut : 7 h 30 de sommeil, 15 min pour s'endormir, rappel 30 min avant.
    static final int DEFAULT_SLEEP = 450;
    static final int DEFAULT_LATENCY = 15;
    static final int DEFAULT_ADVANCE = 30;

    private SleepScheduler() {}

    /* ---------- Réglages ---------- */

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject getSettings(Context ctx) {
        SharedPreferences p = prefs(ctx);
        JSONObject o = new JSONObject();
        try {
            o.put("enabled", p.getBoolean("enabled", false));
            o.put("sleepMin", p.getInt("sleepMin", DEFAULT_SLEEP));
            o.put("latencyMin", p.getInt("latencyMin", DEFAULT_LATENCY));
            o.put("advanceMin", p.getInt("advanceMin", DEFAULT_ADVANCE));
        } catch (Exception ignored) { }
        return o;
    }

    static void saveSettings(Context ctx, JSONObject o) {
        prefs(ctx).edit()
            .putBoolean("enabled", o.optBoolean("enabled", false))
            .putInt("sleepMin", clamp(o.optInt("sleepMin", DEFAULT_SLEEP), 240, 720))
            .putInt("latencyMin", clamp(o.optInt("latencyMin", DEFAULT_LATENCY), 0, 120))
            .putInt("advanceMin", clamp(o.optInt("advanceMin", DEFAULT_ADVANCE), 0, 180))
            .apply();
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    /* ---------- Calcul ---------- */

    /** Heure du prochain réveil en millisecondes, ou 0 s'il n'y en a pas. */
    static long nextAlarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return 0;
        AlarmManager.AlarmClockInfo info = am.getNextAlarmClock();
        return info == null ? 0 : info.getTriggerTime();
    }

    static long bedtimeFor(Context ctx, long wake) {
        SharedPreferences p = prefs(ctx);
        int total = p.getInt("sleepMin", DEFAULT_SLEEP) + p.getInt("latencyMin", DEFAULT_LATENCY);
        return wake - total * 60_000L;
    }

    static long reminderFor(Context ctx, long bedtime) {
        return bedtime - prefs(ctx).getInt("advanceMin", DEFAULT_ADVANCE) * 60_000L;
    }

    /* ---------- Planification ---------- */

    private static PendingIntent pending(Context ctx, String action, int rc) {
        Intent i = new Intent(ctx, SleepReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, rc, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Recalcule tout à partir du réveil actuel. Appelé à chaque événement. */
    static void reschedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent remindPi = pending(ctx, ACTION_REMIND, RC_REMIND);
        PendingIntent checkPi = pending(ctx, ACTION_CHECK, RC_CHECK);
        am.cancel(remindPi);

        if (!prefs(ctx).getBoolean("enabled", false)) {
            am.cancel(checkPi);
            return;
        }

        // Vérification horaire pour suivre les changements de réveil.
        am.setInexactRepeating(AlarmManager.RTC,
            System.currentTimeMillis() + AlarmManager.INTERVAL_HOUR,
            AlarmManager.INTERVAL_HOUR, checkPi);

        long wake = nextAlarm(ctx);
        if (wake == 0) return;
        long bed = bedtimeFor(ctx, wake);
        long remind = reminderFor(ctx, bed);
        long now = System.currentTimeMillis();

        if (remind > now + 60_000L) {
            // Rappel inexact mais autorisé en veille : quelques minutes de décalage
            // au pire, sans demander la permission « alarmes exactes ».
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, remind, remindPi);
        } else if (now < bed + 60 * 60_000L) {
            // Le moment du rappel est déjà passé (réveil réglé tard) : on prévient tout de suite.
            maybeNotify(ctx, wake, bed);
        }
    }

    /** Appelé quand l'alarme de rappel sonne. */
    static void onRemind(Context ctx) {
        long wake = nextAlarm(ctx);
        if (wake != 0 && prefs(ctx).getBoolean("enabled", false)) {
            long bed = bedtimeFor(ctx, wake);
            long remind = reminderFor(ctx, bed);
            long now = System.currentTimeMillis();
            // On vérifie que le réveil n'a pas changé entre-temps.
            if (now >= remind - 10 * 60_000L && now < bed + 60 * 60_000L) {
                maybeNotify(ctx, wake, bed);
            }
        }
        reschedule(ctx);
    }

    /* ---------- Notification ---------- */

    private static void maybeNotify(Context ctx, long wake, long bed) {
        SharedPreferences p = prefs(ctx);
        if (p.getLong("lastNotifiedWake", 0) == wake) return; // une seule fois par réveil
        if (show(ctx, wake, bed)) p.edit().putLong("lastNotifiedWake", wake).apply();
    }

    static void ensureChannel(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Rappel de coucher",
            NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Te prévient avant l'heure de te coucher, selon ton réveil.");
        nm.createNotificationChannel(ch);
    }

    static boolean notificationsAllowed(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    static String hhmm(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.FRANCE).format(new Date(ms));
    }

    static String durationText(int minutes) {
        int h = minutes / 60;
        int m = minutes % 60;
        return h + " h" + (m == 0 ? "" : " " + (m < 10 ? "0" : "") + m);
    }

    /** Affiche la notification. Retourne false si les notifications sont refusées. */
    static boolean show(Context ctx, long wake, long bed) {
        if (!notificationsAllowed(ctx)) return false;
        ensureChannel(ctx);

        Intent open = new Intent(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        int sleepMin = prefs(ctx).getInt("sleepMin", DEFAULT_SLEEP);
        String title = "Couche-toi à " + hhmm(bed);
        String text = "Réveil à " + hhmm(wake) + " : au lit à " + hhmm(bed) +
            " pour dormir " + durationText(sleepMin) + ".";

        android.app.Notification n = new android.app.Notification.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_moon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(text))
            .setCategory(android.app.Notification.CATEGORY_REMINDER)
            .setContentIntent(openPi)
            .setAutoCancel(true)
            .build();

        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        nm.notify(NOTIF_ID, n);
        return true;
    }
}
