package fr.getsugo.naturalift;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Reçoit le rappel planifié, la vérification horaire, le redémarrage et le changement de réveil. */
public class SleepReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (SleepScheduler.ACTION_REMIND.equals(action)) {
            SleepScheduler.onRemind(ctx);
        } else {
            SleepScheduler.reschedule(ctx);
        }
    }
}
