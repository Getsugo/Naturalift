package fr.getsugo.naturalift;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Fonctions natives accessibles depuis app.js via window.NaturaLiftNative.
 * Toutes les valeurs échangées sont des nombres ou du texte (JSON).
 */
public class NativeBridge {

    private final MainActivity activity;

    NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isApp() {
        return true;
    }

    /** Heure du prochain réveil (ms depuis 1970), 0 si aucun réveil. */
    @JavascriptInterface
    public double getNextAlarm() {
        return (double) SleepScheduler.nextAlarm(activity);
    }

    @JavascriptInterface
    public String getSleepSettings() {
        JSONObject o = SleepScheduler.getSettings(activity);
        try {
            o.put("notificationsAllowed", SleepScheduler.notificationsAllowed(activity));
        } catch (Exception ignored) { }
        return o.toString();
    }

    /** Enregistre les réglages (JSON) et replanifie le rappel. */
    @JavascriptInterface
    public void setSleepSettings(String json) {
        try {
            SleepScheduler.saveSettings(activity, new JSONObject(json));
        } catch (Exception ignored) { }
        SleepScheduler.reschedule(activity);
    }

    /** Demande l'autorisation d'afficher des notifications (Android 13+). */
    @JavascriptInterface
    public void requestNotifications() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (Build.VERSION.SDK_INT >= 33 &&
                    activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
                    activity.requestPermissions(
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, MainActivity.RC_NOTIF);
                    return;
                }
                if (Build.VERSION.SDK_INT >= 33 &&
                    activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    !activity.getSharedPreferences("sleep", 0).getBoolean("askedNotif", false)) {
                    activity.getSharedPreferences("sleep", 0).edit().putBoolean("askedNotif", true).apply();
                    activity.requestPermissions(
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, MainActivity.RC_NOTIF);
                    return;
                }
                // Refus définitif ou notifications coupées : on ouvre les réglages de l'appli.
                Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
                activity.startActivity(i);
            }
        });
    }

    /** Notification d'essai, pour vérifier que tout marche. */
    @JavascriptInterface
    public boolean testNotification() {
        long wake = SleepScheduler.nextAlarm(activity);
        if (wake == 0) wake = System.currentTimeMillis() + 8 * 3600_000L;
        return SleepScheduler.show(activity, wake, SleepScheduler.bedtimeFor(activity, wake));
    }

    /* ---------- Résumé du jour (widget + rappels) ---------- */

    @JavascriptInterface
    public void setDaySummary(String json) {
        ReminderScheduler.saveSummary(activity, json);
        NaturaLiftWidget.updateAll(activity);
    }

    /* ---------- Rappels ---------- */

    @JavascriptInterface
    public String getReminders() {
        return ReminderScheduler.load(activity).toString();
    }

    @JavascriptInterface
    public void setReminders(String json) {
        ReminderScheduler.save(activity, json);
    }

    /* ---------- Samsung Health (Health Connect) ---------- */

    @JavascriptInterface
    public String healthStatus() {
        try {
            return HealthBridge.status(activity);
        } catch (Throwable t) {
            return "unavailable";
        }
    }

    @JavascriptInterface
    public void requestHealth() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if ("update_required".equals(healthStatus())) {
                        activity.startActivity(HealthBridge.storeIntent());
                    } else {
                        activity.startActivityForResult(
                            HealthBridge.permissionIntent(activity), MainActivity.RC_HEALTH);
                    }
                } catch (Exception ignored) { }
            }
        });
    }

    @JavascriptInterface
    public void syncHealth() {
        try {
            HealthBridge.sync(activity, new HealthBridge.Callback() {
                @Override
                public void done(String json) {
                    activity.sendHealth(json);
                }
            });
        } catch (Throwable ignored) { }
    }

    /* ---------- Divers ---------- */

    /** Numéro de version de l'appli installée (comparé aux versions publiées). */
    @JavascriptInterface
    public int getVersionCode() {
        try {
            return (int) activity.getPackageManager()
                .getPackageInfo(activity.getPackageName(), 0).getLongVersionCode();
        } catch (Exception e) {
            return 0;
        }
    }

    /** Ouvre un lien du dépôt NaturaLift (mise à jour) dans le navigateur. */
    @JavascriptInterface
    public void openUrl(String url) {
        if (url == null || !url.startsWith("https://github.com/Getsugo/Naturalift/")) return;
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) { }
    }

    /** Partage un texte (liste de courses) vers une autre appli. */
    @JavascriptInterface
    public boolean share(String text) {
        try {
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, text);
            activity.startActivity(Intent.createChooser(send, "Partager la liste"));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Enregistre un fichier texte dans Téléchargements (sauvegarde JSON). */
    @JavascriptInterface
    public boolean saveFile(String name, String mime, String content) {
        try {
            String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            ContentResolver cr = activity.getContentResolver();
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) return false;
            OutputStream out = cr.openOutputStream(uri);
            if (out == null) return false;
            out.write(content.getBytes(StandardCharsets.UTF_8));
            out.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
