export const MIN_BROWSER_SHARE = 0.5;
export const MIN_VERSION_SHARE = 1;

export const DEFAULTS = {
  chromeDesktop: {
    distribution: {
      '147': 80,
      '148': 20,
    },
  },
  chromeAndroid: {
    distribution: {
      '147': 36,
      '148': 64,
    },
  },
  chromeIOS: {
    distribution: {
      '146': 67,
      '147': 18,
      '148': 15,
    },
  },
  safariMacOS: {
    distribution: {
      '26.5': 79,
      '26.4': 21,
    },
  },
  safariIOS: {
    distribution: {
      '26.5': 22,
      '26.4': 78,
    },
  },
  brave: {
    distribution: {
      '1.90': 88,
      '1.89': 3,
      '1.88': 9,
    },
  },
  androidWebView: {
    distribution: {
      '147': 4,
      '148': 96,
    },
  },
};

export const DESKTOP_AVAILABILITY = {"windows":["Chrome","Firefox","Edge","Opera","Brave","Vivaldi","Yandex Browser","IE"],"macos":["Safari","Chrome","Firefox","Edge","Opera","Brave","Vivaldi"],"linux":["Chrome","Firefox","Chromium","Edge","Opera","Brave","Vivaldi"],"chromeos":["Chrome"]};

export const MOBILE_AVAILABILITY = {"android":["Chrome","Samsung Internet","Opera","Firefox","UC Browser","Edge","Android","Yandex Browser","Brave"],"ios":["Safari","Chrome","Firefox","Edge","Opera"]};