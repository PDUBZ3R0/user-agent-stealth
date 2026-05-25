export const MIN_BROWSER_SHARE = 0.5;
export const MIN_VERSION_SHARE = 1;

export const DEFAULTS = {
  chromeDesktop: {
    distribution: {
      '147': 15,
      '148': 50,
      '149': 35,
    },
  },
  chromeAndroid: {
    distribution: {
      '147': 11,
      '148': 7,
      '149': 82,
    },
  },
  chromeIOS: {
    distribution: {
      '147': 9,
      '148': 46,
      '149': 45,
    },
  },
  safariMacOS: {
    distribution: {
      '26.5': 76,
      '26.4': 24,
    },
  },
  safariIOS: {
    distribution: {
      '26.5': 23,
      '26.4': 77,
    },
  },
  brave: {
    distribution: {
      '1.90': 73,
      '1.89': 22,
      '1.88': 5,
    },
  },
  androidWebView: {
    distribution: {
      '147': 31,
      '148': 66,
      '149': 3,
    },
  },
};

export const DESKTOP_AVAILABILITY = {"windows":["Chrome","Firefox","Edge","Opera","Brave","Vivaldi","Yandex Browser","IE"],"macos":["Safari","Chrome","Firefox","Edge","Opera","Brave","Vivaldi"],"linux":["Chrome","Firefox","Chromium","Edge","Opera","Brave","Vivaldi"],"chromeos":["Chrome"]};
export const MOBILE_AVAILABILITY = {"android":["Chrome","Samsung Internet","Opera","Firefox","UC Browser","Edge","Android","Yandex Browser","Brave"],"ios":["Safari","Chrome","Firefox","Edge","Opera"]};