package fr.getsugo.naturalift;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * Rappels quotidiens : pesée du matin, collation protéinée, créatine.
 *
 * Chaque rappel est planifié pour sa prochaine heure, puis replanifié pour le
 * lendemain quand il sonne. Il ne s'affiche pas si c'est déjà fait (pesée notée,
 * créatine cochée, protéines atteintes), grâce au résumé du jour envoyé par l'appli.
 */
public final class ReminderScheduler {

    static final String ACTION_REMINDER = "fr.getsugo.naturalift.REMINDER";
    static final String EXTRA_ID = "id";

    private static final String PREFS = "app";
    private static final String KEY_REMINDERS = "reminders";
    private static final String KEY_SUMMARY = "summary";
    private static final String CHANNEL_ID = "rappels";

    // id, libellé, heure et minute par défaut. Tous désactivés au départ.
    private static final String[][] DEFAULTS = {
        {"weigh", "Pesée du matin", "7", "30"},
        {"snack", "Collation protéinée", "16", "0"},
        {"creatine", "Créatine", "12", "0"},
    };

    private ReminderScheduler() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ---------- Réglages ---------- */

    static JSONArray load(Context ctx) {
        JSONArray saved;
        try {
            saved = new JSONArray(prefs(ctx).getString(KEY_REMINDERS, "[]"));
        } catch (Exception e) {
            saved = new JSONArray();
        }
        JSONArray out = new JSONArray();
        for (int i = 0; i < DEFAULTS.length; i++) {
            String[] d = DEFAULTS[i];
            JSONObject o = new JSONObject();
            try {
                o.put("id", d[0]);
                o.put("label", d[1]);
                o.put("enabled", false);
                o.put("hour", Integer.parseInt(d[2]));
                o.put("minute", Integer.parseInt(d[3]));
                for (int j = 0; j < saved.length(); j++) {
                    JSONObject s = saved.optJSONObject(j);
                    if (s != null && d[0].equals(s.optString("id"))) {
                        o.put("enabled", s.optBoolean("enabled", false));
                        o.put("hour", clamp(s.optInt("hour", Integer.parseInt(d[2])), 0, 23));
                        o.put("minute", clamp(s.optInt("minute", Integer.parseInt(d[3])), 0, 59));
                    }
                }
                out.put(o);
            } catch (Exception ignored) { }
        }
        return out;
    }

    static void save(Context ctx, String json) {
        try {
            JSONArray in = new JSONArray(json);
            prefs(ctx).edit().putString(KEY_REMINDERS, in.toString()).apply();
        } catch (Exception ignored) { }
        scheduleAll(ctx);
    }

    static void saveSummary(Context ctx, String json) {
        try {
            new JSONObject(json); // on ne garde que du JSON valide
            prefs(ctx).edit().putString(KEY_SUMMARY, json).apply();
        } catch (Exception ignored) { }
    }

    /** Résumé du jour envoyé par l'appli, ou null s'il date d'un autre jour. */
    static JSONObject todaySummary(Context ctx) {
        try {
            JSONObject s = new JSONObject(prefs(ctx).getString(KEY_SUMMARY, "{}"));
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.FRANCE).format(new Date());
            return today.equals(s.optString("date")) ? s : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    /* ---------- Planification ---------- */

    private static PendingIntent pending(Context ctx, String id, int index) {
        Intent i = new Intent(ctx, SleepReceiver.class)
            .setAction(ACTION_REMINDER)
            .putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(ctx, 100 + index, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void scheduleAll(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        JSONArray list = load(ctx);
        for (int i = 0; i < list.length(); i++) {
            JSONObject r = list.optJSONObject(i);
            if (r == null) continue;
            PendingIntent pi = pending(ctx, r.optString("id"), i);
            am.cancel(pi);
            if (!r.optBoolean("enabled")) continue;

            Calendar c = Calendar.getInstance();
            c.set(Calendar.HOUR_OF_DAY, r.optInt("hour"));
            c.set(Calendar.MINUTE, r.optInt("minute"));
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            if (c.getTimeInMillis() <= System.currentTimeMillis() + 30_000L) c.add(Calendar.DAY_OF_YEAR, 1);
            // Inexact mais autorisé en veille : quelques minutes de décalage au pire.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), pi);
        }
    }

    /* ---------- Notification ---------- */

    static void onFire(Context ctx, String id) {
        JSONObject s = todaySummary(ctx);
        String title = null;
        String text = null;

        if ("weigh".equals(id)) {
            if (s == null || !s.optBoolean("weighed")) {
                title = "Pesée du matin";
                text = "À jeun, après être passé aux toilettes : note ton poids dans NaturaLift.";
            }
        } else if ("creatine".equals(id)) {
            if (s == null || !s.optBoolean("creatine")) {
                title = "Créatine";
                text = "Pense à tes 3 à 5 g de créatine aujourd'hui, puis coche-la dans l'appli.";
            }
        } else if ("snack".equals(id)) {
            int left = s == null ? -1 : s.optInt("protTarget") - s.optInt("protEaten");
            if (s == null) {
                title = "Collation protéinée";
                text = "Skyr, fromage blanc, œufs… ta collation aide à atteindre tes protéines.";
            } else if (left > 15) {
                title = "Il te reste " + left + " g de protéines";
                text = "C'est le moment de ta collation : skyr, fromage blanc, œufs…";
            }
        }

        if (title != null) show(ctx, id, title, text);
        scheduleAll(ctx); // prochaine occurrence (demain)
    }

    private static void show(Context ctx, String id, String title, String text) {
        if (!SleepScheduler.notificationsAllowed(ctx)) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Rappels du jour",
                NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Pesée, collation protéinée et créatine.");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 1, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        android.app.Notification n = new android.app.Notification.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(text))
            .setCategory(android.app.Notification.CATEGORY_REMINDER)
            .setContentIntent(openPi)
            .setAutoCancel(true)
            .build();
        nm.notify(200 + Math.abs(id.hashCode() % 100), n);
    }
}
