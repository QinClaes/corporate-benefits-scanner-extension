// data/offers.js
//
// Hardcoded list of partner offers for the Benefits@Work Notifier extension.
//
// Each entry:
//   - id:         stable internal identifier
//   - name:       display name shown in the toast and popup
//   - offerPath:  path on the user's Benefits@Work subdomain — composed at runtime as
//                   `https://${subdomain}.benefitsatwork.be${offerPath}`
//                 PLACEHOLDER values: replace `/offer/{id}/cat/{catId}` with the real
//                 IDs scraped from the platform once you have them.
//   - domains:    list of registrable domains (no subdomain, no protocol) on which the
//                 toast should appear. Suffix-matched in lib/matcher.js so
//                 `www.adidas.com` and `shop.adidas.com` both resolve to `adidas.com`.

export const OFFERS = [
  {
    id: "adidas",
    name: "adidas",
    offerPath: "/offer/10001/cat/10",
    domains: ["adidas.com", "adidas.be", "adidas.nl", "adidas.fr"]
  },
  {
    id: "garmin",
    name: "Garmin",
    offerPath: "/offer/10002/cat/10",
    domains: ["garmin.com", "garmin.be", "garmin.nl"]
  },
  {
    id: "expedia",
    name: "Expedia",
    offerPath: "/offer/10003/cat/20",
    domains: ["expedia.com", "expedia.be", "expedia.nl", "expedia.fr"]
  },
  {
    id: "kinepolis",
    name: "Kinepolis",
    offerPath: "/offer/10004/cat/30",
    domains: ["kinepolis.com", "kinepolis.be"]
  },
  {
    id: "dyson",
    name: "Dyson",
    offerPath: "/offer/10005/cat/10",
    domains: ["dyson.com", "dyson.be", "dyson.nl"]
  },
  {
    id: "sixt",
    name: "SIXT rent a car",
    offerPath: "/offer/10006/cat/20",
    domains: ["sixt.com", "sixt.be", "sixt.nl", "sixt.fr"]
  },
  {
    id: "philips",
    name: "Philips",
    offerPath: "/offer/10007/cat/10",
    domains: ["philips.com", "philips.be", "philips.nl"]
  },
  {
    id: "torfs",
    name: "Torfs",
    offerPath: "/offer/10008/cat/40",
    domains: ["torfs.be"]
  },
  {
    id: "iciparisxl",
    name: "Ici Paris XL",
    offerPath: "/offer/10009/cat/40",
    domains: ["iciparisxl.be", "iciparisxl.nl"]
  },
  {
    id: "hema",
    name: "HEMA",
    offerPath: "/offer/10010/cat/40",
    domains: ["hema.nl", "hema.be"]
  }
];
