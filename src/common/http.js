// Shared HTTP helpers. Runtime code is plain ES2020 with Promise chains so it
// runs inside Nuvio's Hermes engine without transpiling.

var NAMA_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

function namaFetchText(url, opts) {
  opts = opts || {};
  var headers = Object.assign({ "User-Agent": NAMA_UA }, opts.headers || {});
  return fetch(url, { method: opts.method || "GET", headers: headers, body: opts.body }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
    return res.text();
  });
}

function namaFetchJson(url, opts) {
  return namaFetchText(url, opts).then(function (t) {
    return JSON.parse(t);
  });
}

function namaOrigin(url) {
  var m = /^(https?:\/\/[^\/]+)/i.exec(url);
  return m ? m[1] : "";
}

function namaHost(url) {
  return namaOrigin(url).replace(/^https?:\/\//i, "");
}

// Resolve a playlist URI against the playlist it came from.
function namaResolveUrl(uri, baseUrl) {
  if (/^https?:\/\//i.test(uri)) return uri;
  if (uri.indexOf("//") === 0) return "https:" + uri;
  if (uri.charAt(0) === "/") return namaOrigin(baseUrl) + uri;
  var dir = baseUrl.split("?")[0].replace(/[^\/]*$/, "");
  return dir + uri;
}

var NAMA_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// UTF-8 safe base64 encoder (btoa is not guaranteed in Hermes).
function namaBase64(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  var out = "";
  for (var j = 0; j < bytes.length; j += 3) {
    var n = (bytes[j] << 16) | ((bytes[j + 1] || 0) << 8) | (bytes[j + 2] || 0);
    out += NAMA_B64[(n >> 18) & 63] + NAMA_B64[(n >> 12) & 63];
    out += j + 1 < bytes.length ? NAMA_B64[(n >> 6) & 63] : "=";
    out += j + 2 < bytes.length ? NAMA_B64[n & 63] : "=";
  }
  return out;
}
