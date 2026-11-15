package com.yosadraw.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(YosaFilesPlugin.class);
        super.onCreate(savedInstanceState);
        WebView web = getBridge().getWebView();
        // Lienzo de dibujo: sin zoom de página, sin rebote al desplazar y sin menú de texto al mantener pulsado.
        WebSettings s = web.getSettings();
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHapticFeedbackEnabled(false);
    }
}
