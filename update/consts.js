export const MIN_BROWSER_SHARE = 0.5;
export const MIN_VERSION_SHARE = 1;

export const DEFAULTS = {
  chromeDesktop: {
    distribution: {
      '147': 48,
      '148': 52,
    },
  },
  chromeAndroid: {
    distribution: {
      '147': 56,
      '148': 44,
    },
  },
  chromeIOS: {
    distribution: {
      '146': 67,
      '147': 20,
      '148': 13,
    },
  },
  safariMacOS: {
    distribution: {
      '26.5': 96,
      '26.4': 4,
    },
  },
  safariIOS: {
    distribution: {
      '26.5': 25,
      '26.4': 75,
    },
  },
  brave: {
    distribution: {
      '1.90': 68,
      '1.89': 8,
      '1.88': 24,
    },
  },
  androidWebView: {
    distribution: {
      '146': 21,
      '147': 40,
      '148': 39,
    },
  },
};

export const DESKTOP_AVAILABILITY = {
  "windows": [
    "Chrome",
    "Firefox",
    "Edge",
    "Opera",
    "Brave",
    "Vivaldi",
    "Yandex Browser",
    "IE"
  ],
  "macos": [
    "Safari",
    "Chrome",
    "Firefox",
    "Edge",
    "Opera",
    "Brave",
    "Vivaldi"
  ],
  "linux": [
    "Chrome",
    "Firefox",
    "Chromium",
    "Edge",
    "Opera",
    "Brave",
    "Vivaldi"
  ],
  "chromeos": [
    "Chrome"
  ]
};

export const MOBILE_AVAILABILITY = {
  "android": [
    "Chrome",
    "Samsung Internet",
    "Opera",
    "Firefox",
    "UC Browser",
    "Edge",
    "Android",
    "Yandex Browser",
    "Brave"
  ],
  "ios": [
    "Safari",
    "Chrome",
    "Firefox",
    "Edge",
    "Opera"
  ]
};