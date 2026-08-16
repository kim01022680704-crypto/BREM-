package kr.brem.rider;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BremNotify")
public class BremNotifyPlugin extends Plugin {
    private static final String CHANNEL_ID = "brem_urgent";

    @PluginMethod
    public void show(PluginCall call) {
        String title = String.valueOf(call.getString("title", "BREM")).trim();
        String body = String.valueOf(call.getString("body", "")).trim();
        if (title.isEmpty()) {
            title = "BREM";
        }
        ensureChannel();
        int id = (int) (System.currentTimeMillis() % 1000000000L);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true);
        NotificationManagerCompat.from(getContext()).notify(id, builder.build());
        call.resolve();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "BREM 알림",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }
}
