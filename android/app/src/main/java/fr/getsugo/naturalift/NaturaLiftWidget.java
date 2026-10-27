package fr.getsugo.naturalift;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.Locale;

/** Widget d'écran d'accueil : calories et protéines restantes aujourd'hui. */
public class NaturaLiftWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(ctx));
    }

    static void updateAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        if (manager == null) return;
        int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, NaturaLiftWidget.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews views = build(ctx);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_naturalift);
        JSONObject s = ReminderScheduler.todaySummary(ctx);
        NumberFormat nf = NumberFormat.getIntegerInstance(Locale.FRANCE);

        if (s == null) {
            v.setTextViewText(R.id.widgetKcal, "—");
            v.setTextViewText(R.id.widgetKcalLabel, "kcal restantes");
            v.setTextViewText(R.id.widgetProt, "Ouvre l'appli pour démarrer ta journée");
        } else {
            int kcalLeft = s.optInt("kcalTarget") - s.optInt("kcalEaten");
            int protLeft = s.optInt("protTarget") - s.optInt("protEaten");
            if (kcalLeft >= 0) {
                v.setTextViewText(R.id.widgetKcal, nf.format(kcalLeft));
                v.setTextViewText(R.id.widgetKcalLabel, "kcal restantes");
            } else {
                v.setTextViewText(R.id.widgetKcal, "+" + nf.format(-kcalLeft));
                v.setTextViewText(R.id.widgetKcalLabel, "kcal de trop");
            }
            v.setTextViewText(R.id.widgetProt, protLeft > 0
                ? "Protéines : il reste " + protLeft + " g"
                : "Protéines : objectif atteint ✓");
        }

        Intent open = new Intent(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 2, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widgetRoot, pi);
        return v;
    }
}
