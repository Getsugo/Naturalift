package fr.getsugo.naturalift;

import android.app.Activity;
import android.os.Bundle;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Explication affichée par Health Connect quand on demande pourquoi
 * l'appli veut lire ces données (obligatoire pour obtenir les autorisations).
 */
public class PrivacyActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView t = new TextView(this);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        t.setPadding(pad, pad * 2, pad, pad);
        t.setTextColor(0xFFE7EAEE);
        t.setTextSize(16);
        t.setLineSpacing(0, 1.3f);
        t.setText(
            "NaturaLift lit, sans jamais les modifier :\n\n"
            + "• ton sommeil, pour afficher la durée de ta nuit ;\n"
            + "• tes pas, pour ajouter des calories les jours où tu marches plus que d'habitude ;\n"
            + "• tes séances, pour passer la journée en « Entraînement ».\n\n"
            + "Ces données restent sur ton téléphone : elles ne sont envoyées à aucun serveur. "
            + "Tu peux retirer l'accès à tout moment dans Health Connect.");
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(0xFF0B0D10);
        sv.addView(t);
        setContentView(sv);
        setTitle(R.string.privacy_title);
    }
}
