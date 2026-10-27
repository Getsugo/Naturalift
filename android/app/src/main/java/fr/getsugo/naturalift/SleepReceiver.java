package fr.getsugo.naturalift;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Reçoit les alarmes de l'appli (rappel de coucher, vérification horaire, rappels
 * du jour) ainsi que le redémarrage du téléphone et le changement de réveil.
 */
public class SleepReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (SleepScheduler.ACTION_REMIND.equals(action)) {
            SleepScheduler.onRemind(ctx);
        } else if (ReminderScheduler.ACTION_REMINDER.equals(action)) {
            ReminderScheduler.onFire(ctx, intent.getStringExtra(ReminderScheduler.EXTRA_ID));
        } else {
            SleepScheduler.reschedule(ctx);
            if (!SleepScheduler.ACTION_CHECK.equals(action)) {
                // Redémarrage, mise à jour de l'appli ou réveil modifié.
                ReminderScheduler.scheduleAll(ctx);
                NaturaLiftWidget.updateAll(ctx);
            }
        }
    }
}
