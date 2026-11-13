package com.max.erp.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@ExperimentalGetImage
public final class MainActivity extends ComponentActivity {
    private static final String PREFS = "max-mobile";
    private static final String SERVER_URL = "server-url";

    private final AtomicBoolean scanInProgress = new AtomicBoolean(false);
    private final ExecutorService cameraExecutor = Executors.newSingleThreadExecutor();
    private final BarcodeScanner barcodeScanner = BarcodeScanning.getClient(
        new BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build()
    );

    private FrameLayout content;
    private FrameLayout scannerLayer;
    private PreviewView previewView;
    private WebView webView;
    private TextView scanHint;
    private ProcessCameraProvider cameraProvider;
    private String serverUrl;
    private boolean cameraBound;
    private boolean qrAccepted;

    private final androidx.activity.result.ActivityResultLauncher<String> cameraPermission =
        registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted) startCamera();
            else Toast.makeText(this, R.string.camera_permission, Toast.LENGTH_LONG).show();
        });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildScreen();
        serverUrl = getSharedPreferences(PREFS, MODE_PRIVATE).getString(SERVER_URL, null);
        if (isValidMobileUrl(serverUrl)) {
            openServer(serverUrl);
        } else {
            serverUrl = null;
            showScanner();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void buildScreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(7, 16, 24));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return windowInsets;
        });

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(18), dp(12), dp(14), dp(12));
        toolbar.setBackgroundColor(Color.rgb(12, 20, 32));

        TextView title = new TextView(this);
        title.setText(R.string.app_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(19);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));

        Button scanButton = new Button(this);
        scanButton.setText(R.string.scan_qr);
        scanButton.setTextColor(Color.WHITE);
        scanButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(47, 111, 237)));
        scanButton.setOnClickListener(v -> showScanner());
        toolbar.addView(scanButton, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            dp(44)
        ));

        content = new FrameLayout(this);
        root.addView(toolbar, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        root.addView(content, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1
        ));
        setContentView(root);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (scannerLayer.getVisibility() == View.VISIBLE && serverUrl != null) {
                    openServer(serverUrl);
                } else if (webView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finish();
                }
            }
        });

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 16, 24));
        WebSettings settings = webView.getSettings();
        // MAX's UI requires JavaScript; navigation stays on the scanned HTTPS origin.
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (sameOrigin(serverUrl, target)) return false;
                openExternal(target);
                return true;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
                Toast.makeText(MainActivity.this, R.string.ssl_error, Toast.LENGTH_LONG).show();
            }
        });
        content.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        scannerLayer = new FrameLayout(this);
        scannerLayer.setBackgroundColor(Color.BLACK);
        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        scannerLayer.addView(previewView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        scanHint = new TextView(this);
        scanHint.setText(R.string.scan_hint);
        scanHint.setTextColor(Color.WHITE);
        scanHint.setTextSize(16);
        scanHint.setGravity(Gravity.CENTER);
        scanHint.setPadding(dp(20), dp(16), dp(20), dp(16));
        scanHint.setBackgroundColor(0xCC071018);
        FrameLayout.LayoutParams hintParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        scannerLayer.addView(scanHint, hintParams);
        content.addView(scannerLayer, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
    }

    private void showScanner() {
        qrAccepted = false;
        scanInProgress.set(false);
        webView.setVisibility(View.GONE);
        scannerLayer.setVisibility(View.VISIBLE);
        scanHint.setText(R.string.scan_hint);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA);
        }
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> providerFuture = ProcessCameraProvider.getInstance(this);
        providerFuture.addListener(() -> {
            try {
                cameraProvider = providerFuture.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build();
                analysis.setAnalyzer(cameraExecutor, this::analyzeFrame);

                cameraProvider.unbindAll();
                cameraProvider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis
                );
                cameraBound = true;
            } catch (Exception e) {
                scanHint.setText(R.string.camera_error);
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void analyzeFrame(ImageProxy imageProxy) {
        if (qrAccepted || !scanInProgress.compareAndSet(false, true)) {
            imageProxy.close();
            return;
        }
        android.media.Image mediaImage = imageProxy.getImage();
        if (mediaImage == null) {
            imageProxy.close();
            scanInProgress.set(false);
            return;
        }
        InputImage input = InputImage.fromMediaImage(mediaImage, imageProxy.getImageInfo().getRotationDegrees());
        barcodeScanner.process(input)
            .addOnSuccessListener(this, barcodes -> {
                for (Barcode barcode : barcodes) {
                    String rawValue = barcode.getRawValue();
                    String acceptedUrl = normalizeQrUrl(rawValue);
                    if (acceptedUrl == null) continue;
                    qrAccepted = true;
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(SERVER_URL, acceptedUrl).apply();
                    runOnUiThread(() -> {
                        Toast.makeText(this, R.string.qr_linked, Toast.LENGTH_LONG).show();
                        openServer(acceptedUrl);
                    });
                    break;
                }
            })
            .addOnFailureListener(this, error -> runOnUiThread(() ->
                scanHint.setText(R.string.qr_read_error)
            ))
            .addOnCompleteListener(this, task -> {
                imageProxy.close();
                scanInProgress.set(false);
            });
    }

    private String normalizeQrUrl(String value) {
        if (value == null) return null;
        try {
            URI scanned = new URI(value.trim());
            if (!"https".equalsIgnoreCase(scanned.getScheme())
                || scanned.getHost() == null
                || scanned.getUserInfo() != null
                || (scanned.getPath() != null
                    && !scanned.getPath().isEmpty()
                    && !"/".equals(scanned.getPath())
                    && !"/movil.html".equals(scanned.getPath()))) {
                runOnUiThread(() -> scanHint.setText(R.string.qr_https_required));
                return null;
            }
            return new URI(
                "https",
                null,
                scanned.getHost(),
                scanned.getPort(),
                "/movil.html",
                null,
                null
            ).toASCIIString();
        } catch (URISyntaxException e) {
            runOnUiThread(() -> scanHint.setText(R.string.qr_invalid));
            return null;
        }
    }

    private boolean isValidMobileUrl(String value) {
        if (value == null) return false;
        try {
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && "/movil.html".equals(uri.getPath())
                && uri.getUserInfo() == null;
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private boolean sameOrigin(String expectedUrl, Uri target) {
        if (expectedUrl == null || target == null || !"https".equalsIgnoreCase(target.getScheme())) return false;
        Uri expected = Uri.parse(expectedUrl);
        return expected.getHost() != null
            && expected.getHost().equalsIgnoreCase(target.getHost())
            && expected.getPort() == target.getPort()
            && "https".equalsIgnoreCase(expected.getScheme());
    }

    private void openServer(String url) {
        serverUrl = url;
        stopCamera();
        scannerLayer.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
    }

    private void openExternal(Uri target) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, target));
        } catch (android.content.ActivityNotFoundException e) {
            Toast.makeText(this, R.string.external_app_missing, Toast.LENGTH_SHORT).show();
        }
    }

    private void stopCamera() {
        if (cameraProvider != null && cameraBound) {
            cameraProvider.unbindAll();
            cameraBound = false;
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null && webView.getVisibility() == View.VISIBLE) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        stopCamera();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        barcodeScanner.close();
        cameraExecutor.shutdown();
        super.onDestroy();
    }
}
