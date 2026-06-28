/* ============================================
   Weather Pluse+ - Firebase Cloud Messaging
   ============================================ */

// Firebase configuration - User's actual project
const firebaseConfig = {
  apiKey: "AIzaSyCGwlXkFlk4QVJR97ZokLdJCC889ZXiIco",
  authDomain: "weather-pluse.firebaseapp.com",
  projectId: "weather-pluse",
  storageBucket: "weather-pluse.firebasestorage.app",
  messagingSenderId: "37105423041",
  appId: "1:37105423041:web:6fe0243c515d9e50ae7a40",
  measurementId: "G-2J0CPR8LRD"
};

// VAPID Key for Web Push
const VAPID_KEY = "BJvO68BdBU_2eTKvAE3NRJHiekOgV5Qy5JziDXbDoIWLh_iNGnA7-wj_wILYY5QoYkScKJ-C4gRAbRKHI7zrAXs";

// Initialize Firebase
let messaging = null;
let firebaseApp = null;

function initFirebase() {
  // Check if Firebase is available
  if (typeof firebase === 'undefined') {
    console.log('Firebase SDK not loaded');
    return;
  }

  try {
    // Initialize app if not already done
    if (!firebase.apps || firebase.apps.length === 0) {
      firebaseApp = firebase.initializeApp(firebaseConfig);
    } else {
      firebaseApp = firebase.app();
    }

    // Check if messaging is supported
    if (firebase.messaging && firebase.messaging.isSupported()) {
      messaging = firebase.messaging();

      // Request permission
      requestNotificationPermission();

      // Handle foreground messages
      messaging.onMessage((payload) => {
        console.log('Message received:', payload);
        showNotification(payload.notification);
      });
    }

    // Initialize Analytics if available
    if (firebase.analytics) {
      firebase.analytics();
    }
  } catch (error) {
    console.error('Firebase init error:', error);
  }
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('Notifications not supported');
    return;
  }

  Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      console.log('Notification permission granted');
      getFCMToken();
    } else {
      console.log('Notification permission denied');
    }
  });
}

function getFCMToken() {
  if (!messaging) return;

  messaging.getToken({ vapidKey: VAPID_KEY })
    .then((token) => {
      if (token) {
        console.log('FCM Token:', token);
        localStorage.setItem('wp_fcm_token', token);

        // Send token to your server or save for later use
        // You can send this token to your backend to send push notifications
      } else {
        console.log('No registration token available.');
      }
    })
    .catch((error) => {
      console.error('FCM token error:', error);
    });
}

function showNotification(notification) {
  if (!notification) return;

  // Show custom toast
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');

  if (toast && toastMessage) {
    toastMessage.textContent = notification.title || 'Weather Alert';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 5000);
  }

  // Also show browser notification if permitted
  if (Notification.permission === 'granted') {
    new Notification(notification.title || 'Weather Pluse+', {
      body: notification.body || '',
      icon: '/WeatherPulse/assets/icons/notification.png',
      badge: '/WeatherPulse/assets/icons/icon-72.png',
      tag: 'weather-alert',
      requireInteraction: false
    });
  }
}

// Weather alert types
const WEATHER_ALERTS = {
  HEAVY_RAIN: { title: 'Heavy Rain Alert', body: 'Heavy rain expected in your area. Stay safe!' },
  STORM: { title: 'Storm Warning', body: 'Severe storm approaching. Seek shelter!' },
  SNOW: { title: 'Snow Alert', body: 'Heavy snowfall expected. Drive carefully!' },
  EXTREME_HEAT: { title: 'Extreme Heat Warning', body: 'High temperatures expected. Stay hydrated!' },
  STRONG_WIND: { title: 'Strong Wind Alert', body: 'Strong winds expected. Secure loose objects!' }
};

function checkWeatherAlerts(weatherData) {
  if (!weatherData || !weatherData.weather) return;

  const condition = weatherData.weather[0]?.main?.toLowerCase() || '';
  const windSpeed = weatherData.wind?.speed || 0;
  const temp = weatherData.main?.temp || 0;
  const tempC = temp; // Already in Celsius with Open-Meteo

  let alert = null;

  if (condition.includes('thunderstorm')) {
    alert = WEATHER_ALERTS.STORM;
  } else if (condition.includes('rain') && weatherData.rain && weatherData.rain['1h'] > 10) {
    alert = WEATHER_ALERTS.HEAVY_RAIN;
  } else if (condition.includes('snow')) {
    alert = WEATHER_ALERTS.SNOW;
  } else if (tempC > 40) {
    alert = WEATHER_ALERTS.EXTREME_HEAT;
  } else if (windSpeed > 15) {
    alert = WEATHER_ALERTS.STRONG_WIND;
  }

  if (alert) {
    showNotification(alert);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Load Firebase SDK dynamically (compat version for messaging support)
  const scripts = [
    'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js',
    'https://www.gstatic.com/firebasejs/10.7.0/firebase-analytics-compat.js'
  ];

  let loadedCount = 0;
  scripts.forEach(src => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      loadedCount++;
      if (loadedCount === scripts.length) {
        initFirebase();
      }
    };
    script.onerror = () => {
      console.log('Failed to load:', src);
    };
    document.head.appendChild(script);
  });
});

// Export for use in main app
window.firebaseConfig = firebaseConfig;
window.VAPID_KEY = VAPID_KEY;
window.checkWeatherAlerts = checkWeatherAlerts;
window.getFCMToken = getFCMToken;