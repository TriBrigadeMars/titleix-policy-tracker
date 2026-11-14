export interface SecurityHeader {
  key: string;
  value: string;
}

/** Shared by hosted Next and the app://tracker desktop transports. */
export function buildSecurityHeaders(options: {
  production: boolean;
  localMode: boolean;
}): SecurityHeader[] {
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${options.production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "object-src 'none'",
  ].join("; ");
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Content-Security-Policy", value: policy },
  ];
  if (!options.localMode) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
