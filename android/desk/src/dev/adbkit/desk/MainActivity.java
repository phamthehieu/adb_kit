package dev.adbkit.desk;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Shows the page ADB Kit serves on this phone's 127.0.0.1 (through adb reverse), full screen and
 * with the screen kept on. The address comes from ADB Kit in the "url" extra; anything that is
 * not on 127.0.0.1 is refused, so no other app can make this one open a web site.
 */
public class MainActivity extends Activity {
    private static final String LOCAL = "http://127.0.0.1:";
    private static final long RETRY_MS = 3000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private String url;

    /** Failed loads in a row; ADB Kit being gone for this long means the board is over. */
    private static final int GIVE_UP_AFTER = 5;
    private int fails;
    private boolean errored;

    private final Runnable retry = new Runnable() {
        @Override
        public void run() {
            if (url == null || isFinishing()) return;
            errored = false;
            web.loadUrl(url);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        showOverLockScreen();

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " ADBKitDesk/1");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String target) {
                return !isLocal(target); // never leave ADB Kit's page
            }

            @Override
            public void onPageFinished(WebView view, String loaded) {
                if (isLocal(loaded) && !errored) fails = 0;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) waiting();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M && failingUrl != null && failingUrl.equals(url)) waiting();
            }
        });
        setContentView(web);
        open(getIntent());
    }

    /**
     * The board may be shown on top of the lock screen, so the phone can stay locked while it is
     * on the desk. Nothing is unlocked: leaving the board still asks for the PIN.
     */
    @SuppressWarnings("deprecation")
    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) setShowWhenLocked(true);
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        open(intent);
    }

    private static boolean isLocal(String u) {
        return u != null && u.startsWith(LOCAL);
    }

    private void open(Intent intent) {
        String u = intent == null ? null : intent.getStringExtra("url");
        handler.removeCallbacks(retry);
        if (isLocal(u)) {
            url = u;
            fails = 0;
            errored = false;
            web.loadUrl(u);
        } else if (url == null) {
            message("Mở tab <b>Bảng theo dõi</b> trong ADB Kit trên máy tính rồi bấm <b>Bật</b>.");
        }
    }

    /**
     * ADB Kit is not reachable (closed, crashed, cable out): say so and try again a few times,
     * then leave so the phone can go back to sleep on its own. ADB Kit opens the app again when
     * the phone is plugged back in while the board is on.
     */
    private void waiting() {
        errored = true;
        if (++fails > GIVE_UP_AFTER) {
            finishAndRemoveTask();
            return;
        }
        message("Đang chờ ADB Kit…<br><small>Kiểm tra dây USB và bảng theo dõi còn bật.</small>");
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
    }

    private void message(String html) {
        String page = "<html><body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;"
                + "background:#000;color:#93a0b8;font:5vmin/1.6 sans-serif;text-align:center;padding:8vmin;box-sizing:border-box\">"
                + "<div>" + html + "</div></body></html>";
        web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }
}
