package com.codey.app;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Map;

final class CodeyPairingLink {
    static final String SCHEME = "codey";
    static final String HOST = "pair";

    final String baseUrl;
    final String deviceCode;
    final String userCode;

    private CodeyPairingLink(String baseUrl, String deviceCode, String userCode) {
        this.baseUrl = baseUrl;
        this.deviceCode = deviceCode;
        this.userCode = userCode;
    }

    static CodeyPairingLink parse(String value) throws Exception {
        if (value == null || value.trim().isEmpty()) {
            throw new Exception("Pairing link is empty.");
        }

        URI uri = new URI(value.trim());
        if (!SCHEME.equalsIgnoreCase(uri.getScheme()) || !HOST.equalsIgnoreCase(uri.getHost())) {
            throw new Exception("QR code is not a Codey pairing link.");
        }

        Map<String, String> query = parseQuery(uri.getRawQuery());
        String baseUrl = trim(query.get("baseUrl"));
        String deviceCode = trim(query.get("deviceCode"));
        String userCode = trim(query.get("userCode"));
        if (baseUrl.isEmpty() || deviceCode.isEmpty() || userCode.isEmpty()) {
            throw new Exception("Pairing link is missing required fields.");
        }

        return new CodeyPairingLink(baseUrl, deviceCode, userCode);
    }

    String approvalUrl() {
        String normalizedBaseUrl = baseUrl;
        while (normalizedBaseUrl.endsWith("/")) {
            normalizedBaseUrl = normalizedBaseUrl.substring(0, normalizedBaseUrl.length() - 1);
        }
        return normalizedBaseUrl + "/device?userCode=" + urlEncode(userCode);
    }

    private static Map<String, String> parseQuery(String rawQuery) throws Exception {
        Map<String, String> query = new HashMap<>();
        if (rawQuery == null || rawQuery.trim().isEmpty()) {
            return query;
        }

        String[] pairs = rawQuery.split("&");
        for (String pair : pairs) {
            int separator = pair.indexOf('=');
            String key = separator >= 0 ? pair.substring(0, separator) : pair;
            String value = separator >= 0 ? pair.substring(separator + 1) : "";
            query.put(urlDecode(key), urlDecode(value));
        }
        return query;
    }

    private static String urlDecode(String value) throws Exception {
        return URLDecoder.decode(value, "UTF-8");
    }

    private static String urlEncode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (Exception ignored) {
            return value;
        }
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
