/**
 * Native GPS Module for Capacitor
 * Uses Capacitor bridge directly - NO ES module imports needed
 * Works when loaded from local files in Capacitor WebView
 *
 * TWO tracking mechanisms:
 * 1. BackgroundGeolocation plugin → JS callbacks (works when WebView is active)
 * 2. NativeGpsStorage service → saves to file natively (works even when screen off)
 *    JS reads stored points on app resume and syncs to Firestore
 */

(function() {
  'use strict';

  // Check if running in Capacitor (native app)
  function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // Get the BackgroundGeolocation plugin via Capacitor bridge
  function getPlugin() {
    if (!window.Capacitor || !window.Capacitor.registerPlugin) return null;
    if (!window._bgGeoPlugin) {
      window._bgGeoPlugin = window.Capacitor.registerPlugin('BackgroundGeolocation');
    }
    return window._bgGeoPlugin;
  }

  // Get the NativeGpsStorage plugin (saves GPS to file natively)
  function getStoragePlugin() {
    if (!window.Capacitor || !window.Capacitor.registerPlugin) return null;
    if (!window._nativeGpsStoragePlugin) {
      window._nativeGpsStoragePlugin = window.Capacitor.registerPlugin('NativeGpsStorage');
    }
    return window._nativeGpsStoragePlugin;
  }

  // Initialize native background GPS
  async function initNativeGps(employeeId, employeeName) {
    if (!isNativeApp()) {
      console.log('[NativeGps] Not running in native app');
      return false;
    }

    // Start the native file-based GPS tracking service (independent of WebView)
    try {
      var storagePlugin = getStoragePlugin();
      if (storagePlugin) {
        await storagePlugin.startTracking({
          employeeId: employeeId || '',
          employeeName: employeeName || ''
        });
        console.log('[NativeGps] Native GPS storage service started');
      }
    } catch (e) {
      console.warn('[NativeGps] Native storage service failed to start:', e);
    }

    // Also start the BackgroundGeolocation plugin for JS callbacks (works when WebView active)
    var plugin = getPlugin();
    if (!plugin) {
      console.error('[NativeGps] BackgroundGeolocation plugin not available');
      return false;
    }

    try {
      var watcherId = await plugin.addWatcher(
        {
          backgroundMessage: 'GPS bao ve dang chay',
          backgroundTitle: 'Quan Tri PHR',
          requestPermissions: true,
          stale: true,
          distanceFilter: 5
        },
        function(location, error) {
          if (error) {
            console.error('[NativeGps] Error:', error.code, error.message);
            if (error.code === 'NOT_AUTHORIZED') {
              if (window.onNativeGpsError) {
                window.onNativeGpsError('permission_denied');
              }
            }
            return;
          }

          if (location && window.onNativeGpsUpdate) {
            // Filter stale locations: reject if older than 60s
            var age = location.time ? (Date.now() - location.time) : 0;
            if (age > 60000) {
              console.log('[NativeGps] Skipping stale location, age:', Math.round(age/1000) + 's');
              return;
            }

            window.onNativeGpsUpdate({
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
              altitude: location.altitude,
              speed: location.speed,
              bearing: location.bearing,
              timestamp: location.time || Date.now()
            });
          }
        }
      );

      window.nativeGpsWatcherId = watcherId;
      console.log('[NativeGps] Background GPS started, watcher:', watcherId);
      return true;

    } catch (error) {
      console.error('[NativeGps] Init failed:', error);
      return false;
    }
  }

  // Stop native GPS (both services)
  async function stopNativeGps() {
    if (!isNativeApp()) return;

    // Stop BackgroundGeolocation watcher
    if (window.nativeGpsWatcherId) {
      try {
        var plugin = getPlugin();
        if (plugin) {
          await plugin.removeWatcher({ id: window.nativeGpsWatcherId });
        }
        window.nativeGpsWatcherId = null;
        console.log('[NativeGps] BackgroundGeolocation stopped');
      } catch (error) {
        console.error('[NativeGps] Stop watcher failed:', error);
      }
    }

    // Stop native tracking service
    try {
      var storagePlugin = getStoragePlugin();
      if (storagePlugin) {
        await storagePlugin.stopTracking();
        console.log('[NativeGps] Native storage service stopped');
      }
    } catch (e) {
      console.warn('[NativeGps] Stop storage service failed:', e);
    }
  }

  // Get GPS points stored natively (when screen was off / WebView paused)
  async function getStoredPoints() {
    if (!isNativeApp()) return { points: [], count: 0 };
    try {
      var storagePlugin = getStoragePlugin();
      if (!storagePlugin) return { points: [], count: 0 };
      var result = await storagePlugin.getStoredPoints();
      console.log('[NativeGps] Got ' + result.count + ' stored native points');
      return result;
    } catch (e) {
      console.error('[NativeGps] Failed to get stored points:', e);
      return { points: [], count: 0 };
    }
  }

  // Clear stored points after syncing
  async function clearStoredPoints() {
    if (!isNativeApp()) return;
    try {
      var storagePlugin = getStoragePlugin();
      if (storagePlugin) {
        await storagePlugin.clearStoredPoints();
        console.log('[NativeGps] Stored points cleared');
      }
    } catch (e) {
      console.error('[NativeGps] Failed to clear stored points:', e);
    }
  }

  // Get count of stored points
  async function getPointCount() {
    if (!isNativeApp()) return 0;
    try {
      var storagePlugin = getStoragePlugin();
      if (!storagePlugin) return 0;
      var result = await storagePlugin.getPointCount();
      return result.count || 0;
    } catch (e) {
      return 0;
    }
  }

  // Open device location settings
  async function openLocationSettings() {
    if (!isNativeApp()) return;
    try {
      var plugin = getPlugin();
      if (plugin && plugin.openSettings) {
        await plugin.openSettings();
      }
    } catch (error) {
      console.error('[NativeGps] Cannot open settings:', error);
    }
  }

  // Export to global scope
  window.NativeGps = {
    isNativeApp: isNativeApp,
    init: initNativeGps,
    stop: stopNativeGps,
    openSettings: openLocationSettings,
    getStoredPoints: getStoredPoints,
    clearStoredPoints: clearStoredPoints,
    getPointCount: getPointCount
  };

  console.log('[NativeGps] Module loaded, isNative:', isNativeApp());
})();
