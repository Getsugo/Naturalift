package fr.getsugo.naturalift;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;

/**
 * Enveloppe Android de NaturaLift : affiche l'appli web embarquée (assets/www)
 * et lui ajoute ce qu'une PWA ne peut pas faire (réveil, notifications, fichiers).
 */
public class MainActivity extends Activity {

    // Adresse « locale » servie par WebViewAssetLoader : l'appli web s'y comporte
    // comme sur un vrai site https (localStorage, appels à Open Food Facts…).
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/assets/www/index.html";

    private static final int RC_FILE = 10;
    private static final int RC_CAMERA = 11;
    static final int RC_NOTIF = 12;
    static final int RC_HEALTH = 13;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutput;
    private PermissionRequest pendingWebPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0D10);
        // La WebView ignore son propre padding : on la place dans un cadre
        // qui, lui, laisse la place aux barres système.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0B0D10);
        root.addView(web, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15 affiche l'appli sous les barres système : on laisse la place.
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                if (Build.VERSION.SDK_INT >= 30) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                    return WindowInsets.CONSUMED;
                }
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets.consumeSystemWindowInsets();
            }
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                // Liens externes : navigateur du téléphone.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Caméra pour le scan de code-barres.
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                        } else {
                            pendingWebPermission = request;
                            requestPermissions(new String[]{Manifest.permission.CAMERA}, RC_CAMERA);
                        }
                        return;
                    }
                }
                request.deny();
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                openChooser(params);
                return true;
            }
        });

        web.addJavascriptInterface(new NativeBridge(this), "NaturaLiftNative");

        SleepScheduler.reschedule(this);
        ReminderScheduler.scheduleAll(this);

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(START_URL);
        }
    }

    /** Sélecteur de fichier : galerie / fichiers, et appareil photo pour les photos de repas. */
    private void openChooser(WebChromeClient.FileChooserParams params) {
        Intent content = params.createIntent();
        boolean wantsImage = false;
        for (String t : params.getAcceptTypes()) {
            if (t != null && t.startsWith("image")) wantsImage = true;
        }

        Intent chooser = Intent.createChooser(content, "Choisir un fichier");
        cameraOutput = null;
        if (wantsImage) {
            try {
                File dir = new File(getCacheDir(), "photos");
                if (!dir.exists()) dir.mkdirs();
                File photo = new File(dir, "repas-" + System.currentTimeMillis() + ".jpg");
                cameraOutput = FileProvider.getUriForFile(this, "fr.getsugo.naturalift.files", photo);
                Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutput);
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            } catch (Exception e) {
                cameraOutput = null;
            }
        }
        try {
            startActivityForResult(chooser, RC_FILE);
        } catch (ActivityNotFoundException e) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RC_HEALTH) {
            // Autorisations Samsung Health accordées (ou non) : la page relit l'état.
            notifyWeb();
            return;
        }
        if (requestCode != RC_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            } else if (data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                result = new Uri[]{data.getClipData().getItemAt(0).getUri()};
            } else if (cameraOutput != null) {
                result = new Uri[]{cameraOutput}; // photo prise avec l'appareil
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == RC_CAMERA && pendingWebPermission != null) {
            if (granted) pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        } else if (requestCode == RC_NOTIF) {
            SleepScheduler.reschedule(this);
            notifyWeb();
        }
    }

    /** Transmet à la page les données lues dans Health Connect. */
    void sendHealth(final String json) {
        if (web == null) return;
        web.post(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(
                    "window.NaturaLiftHealth && window.NaturaLiftHealth(" + JSONObject.quote(json) + ");", null);
            }
        });
    }

    /** Prévient la page qu'un réglage natif a changé (permission, réveil…). */
    void notifyWeb() {
        if (web == null) return;
        web.post(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(
                    "window.dispatchEvent(new Event('naturalift-native'));", null);
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Le réveil a pu changer pendant que l'appli était fermée.
        SleepScheduler.reschedule(this);
        notifyWeb();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
