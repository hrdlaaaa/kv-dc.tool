// Produkční business konfigurace přepravy.
window.TRANSPORT_CONFIG = Object.freeze({
  "version": 1,
  "groups": {
    "inside": {
      "label": "Vnitřek"
    },
    "outside": {
      "label": "Venek"
    }
  },
  "vehicles": [
    {
      "vehicle": "4SD9203",
      "carNumber": "1",
      "group": "outside"
    },
    {
      "vehicle": "5AY0110",
      "carNumber": "2",
      "group": "inside"
    },
    {
      "vehicle": "1AJU764",
      "carNumber": "3",
      "group": "inside"
    },
    {
      "vehicle": "1AJU770",
      "carNumber": "4",
      "group": "inside"
    },
    {
      "vehicle": "4SX3886",
      "carNumber": "5",
      "group": "outside"
    },
    {
      "vehicle": "1ACB163",
      "carNumber": "6",
      "group": "inside"
    },
    {
      "vehicle": "5SM9719",
      "carNumber": "7",
      "group": "inside"
    },
    {
      "vehicle": "6SH4101",
      "carNumber": "8",
      "group": "outside"
    },
    {
      "vehicle": "1ANN490",
      "carNumber": "9",
      "group": "outside"
    },
    {
      "vehicle": "1AIT373",
      "carNumber": "10",
      "group": "outside"
    },
    {
      "vehicle": "1AFH704",
      "carNumber": "11",
      "group": "inside"
    },
    {
      "vehicle": "1ADD843",
      "carNumber": "12",
      "group": "inside"
    },
    {
      "vehicle": "9AI6816",
      "carNumber": "13",
      "group": "outside"
    },
    {
      "vehicle": "6SY6707",
      "carNumber": "14",
      "group": "outside"
    },
    {
      "vehicle": "4AL4570",
      "carNumber": "15",
      "group": "outside"
    },
    {
      "vehicle": "1AIY229",
      "carNumber": "16",
      "group": "outside"
    },
    {
      "vehicle": "7AD3330",
      "carNumber": "X.012",
      "group": "inside"
    },
    {
      "vehicle": "7AP1930",
      "carNumber": "X.014",
      "group": "outside"
    },
    {
      "vehicle": "1ACT567",
      "carNumber": "X.06",
      "group": "inside"
    },
    {
      "vehicle": "4AK7118",
      "carNumber": "Rezerva",
      "group": "inside"
    },
    {
      "vehicle": "4AL2225",
      "carNumber": "Rezerva",
      "group": "inside"
    },
    {
      "vehicle": "8AD0265",
      "carNumber": "Rezerva",
      "group": "inside"
    },
    {
      "vehicle": "BRNO",
      "carNumber": "EX BRNO",
      "group": "outside"
    },
    {
      "vehicle": "EXCESBU",
      "carNumber": "EX ČB",
      "group": "outside"
    },
    {
      "vehicle": "EXKVARY",
      "carNumber": "EX K.VARY",
      "group": "outside"
    },
    {
      "vehicle": "MORAVA",
      "carNumber": "EX MORAVA",
      "group": "outside"
    },
    {
      "vehicle": "OLOMOUC",
      "carNumber": "EX OLOMOUC",
      "group": "outside"
    },
    {
      "vehicle": "EXPRAHA",
      "carNumber": "EX PRAHA",
      "group": "inside"
    },
    {
      "vehicle": "EXTER01",
      "carNumber": "EX1",
      "group": "outside"
    },
    {
      "vehicle": "EXTER02",
      "carNumber": "EX2",
      "group": "outside"
    },
    {
      "vehicle": "EXTER03",
      "carNumber": "EX3",
      "group": "outside"
    },
    {
      "vehicle": "EXTER04",
      "carNumber": "EX4",
      "group": "outside"
    },
    {
      "vehicle": "EXTER05",
      "carNumber": "EX5",
      "group": "outside"
    },
    {
      "vehicle": "EXTER06",
      "carNumber": "EX6",
      "group": "outside"
    },
    {
      "vehicle": "EXTER07",
      "carNumber": "EX7",
      "group": "outside"
    }
  ],
  "placeRules": {
    "branchPrefix": "K & V",
    "emphasizeBranch": true,
    "legalFormAfterCommaPattern": ",\\s*(?:s\\.?\\s*r\\.?\\s*o\\.?|a\\.?\\s*s\\.?|v\\.?\\s*o\\.?\\s*s\\.?|k\\.?\\s*s\\.?|z\\.?\\s*s\\.?|spol\\.?\\s+s\\s+r\\.?\\s*o\\.?)\\s*$"
  }
});
