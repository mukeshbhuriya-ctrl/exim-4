import json
import re
import sys
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


COOKIE_FILE = Path(__file__).with_name("cookie.json")
HOME_URL = "https://www.dgft.gov.in/CP/"
BASE_URL = "https://www.dgft.gov.in/CP/web"
QUERY_PARAMS = {
    "requestType": "ApplicationRH",
    "actionVal": "loadBankRealisationData",
    "screenId": "90000542",
    "_csrf": "58e8072f-507d-4bcd-856e-",
}
CSRF_TOKEN_RE = re.compile(
    r'<meta[^>]+(?:name|property)=["\']_csrf["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
CSRF_HEADER_RE = re.compile(
    r'<meta[^>]+(?:name|property)=["\']_csrf_header["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
FILTERS = {
    "brcNo": "",
    "iecNo": "AAFCI0903C",
    "fromDateOfSelectedBil": "09/04/2026",
    "toDateOfSelectedBil": "15/04/2026",
    "sbNumber": "6584707",
    "sbDate": "31/10/2025",
    "exportPortCode": {
        "key": "683",
        "value": "INHZA1-HAZIRA PORT, CHORYASHI, BYPASS RD., HAZIRA, SURAT-EDI",
    },
    "exportPortCode_key": "683",
    "exportPortCode_value": "INHZA1-HAZIRA PORT, CHORYASHI, BYPASS RD., HAZIRA, SURAT-EDI",
    "invoiceNumber": "",
    "licenseNumber": "",
}
COLUMNS = [
    "brcNumber",
    "uploadDate",
    "realisationDate",
    "realizedAmountCC",
    "invoiceNumber",
    "sbNumber",
    "sbDate",
    "exportPortCode.value",
    "brcStatus.value",
    "utilizationStatus",
    "source",
    "bankFlag",
    "",
    "",
    "",
]


def domain_matches(hostname: str, cookie_domain: str, host_only: bool) -> bool:
    if not cookie_domain:
        return False
    normalized = cookie_domain.lstrip(".").lower()
    hostname = hostname.lower()
    if host_only:
        return hostname == normalized
    return hostname == normalized or hostname.endswith(f".{normalized}")


def path_matches(request_path: str, cookie_path: str) -> bool:
    if not cookie_path:
        return True
    return request_path.startswith(cookie_path)


def load_cookies(cookie_path: Path) -> list[dict]:
    return json.loads(cookie_path.read_text(encoding="utf-8"))


def build_cookie_header(cookies: list[dict], target_url: str) -> str:
    target = urlparse(target_url)
    pairs = []

    for cookie in cookies:
        if not domain_matches(
            target.hostname or "",
            cookie.get("domain", ""),
            bool(cookie.get("hostOnly", False)),
        ):
            continue
        if not path_matches(target.path or "/", cookie.get("path", "/")):
            continue
        if cookie.get("secure") and target.scheme != "https":
            continue
        name = cookie.get("name")
        value = cookie.get("value")
        if name and value is not None:
            pairs.append(f"{name}={value}")

    if not pairs:
        raise ValueError(f"No matching cookies found for {target_url}")

    return "; ".join(pairs)


def upsert_cookie(cookies: list[dict], new_cookie: dict) -> None:
    for index, cookie in enumerate(cookies):
        if (
            cookie.get("name") == new_cookie.get("name")
            and cookie.get("domain") == new_cookie.get("domain")
            and cookie.get("path", "/") == new_cookie.get("path", "/")
        ):
            cookies[index] = new_cookie
            return
    cookies.append(new_cookie)


def merge_set_cookie_headers(
    cookies: list[dict],
    headers,
    request_url: str,
) -> list[dict]:
    merged = [dict(cookie) for cookie in cookies]
    target = urlparse(request_url)

    for set_cookie in headers.get_all("Set-Cookie", []):
        parsed = SimpleCookie()
        parsed.load(set_cookie)
        for morsel in parsed.values():
            cookie_domain = morsel["domain"].lstrip(".") or (target.hostname or "")
            new_cookie = {
                "domain": cookie_domain,
                "hostOnly": not bool(morsel["domain"]),
                "httpOnly": bool(morsel["httponly"]),
                "name": morsel.key,
                "path": morsel["path"] or "/",
                "secure": bool(morsel["secure"]),
                "value": morsel.value,
            }
            upsert_cookie(merged, new_cookie)

    return merged


def build_form_data() -> dict[str, str]:
    payload: dict[str, str] = {
        "draw": "1",
        "order[0][column]": "0",
        "order[0][dir]": "asc",
        "start": "0",
        "length": "10",
        "search[value]": "",
        "search[regex]": "false",
        "dataJson[formData]": json.dumps(FILTERS, separators=(",", ":")),
    }

    for index, column_name in enumerate(COLUMNS):
        payload[f"columns[{index}][data]"] = column_name
        payload[f"columns[{index}][name]"] = ""
        payload[f"columns[{index}][searchable]"] = "true"
        payload[f"columns[{index}][orderable]"] = "true"
        payload[f"columns[{index}][search][value]"] = ""
        payload[f"columns[{index}][search][regex]"] = "false"

    return payload


def extract_csrf_details(html: str) -> tuple[str, str]:
    token_match = CSRF_TOKEN_RE.search(html)
    if not token_match:
        raise ValueError("Could not find `_csrf` token in GET /CP/ response")

    header_match = CSRF_HEADER_RE.search(html)
    header_name = header_match.group(1) if header_match else "X-CSRF-TOKEN"
    return token_match.group(1), header_name


def refresh_csrf(cookies: list[dict]) -> tuple[list[dict], str, str]:
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "max-age=0",
        "Cookie": build_cookie_header(cookies, HOME_URL),
        "Referer": "https://www.dgft.gov.in/CP/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
        ),
    }
    request = Request(HOME_URL, headers=headers, method="GET")

    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8", errors="replace")
        merged_cookies = merge_set_cookie_headers(cookies, response.headers, HOME_URL)

    csrf_token, csrf_header_name = extract_csrf_details(body)
    return merged_cookies, csrf_token, csrf_header_name


def perform_request(
    cookies: list[dict],
    csrf_token: str,
    csrf_header_name: str | None = None,
) -> tuple[int, object, str]:
    query_params = {**QUERY_PARAMS, "_csrf": csrf_token}
    endpoint = f"{BASE_URL}?{urlencode(query_params)}"
    cookie_header = build_cookie_header(cookies, BASE_URL)
    form_data = build_form_data()
    encoded_payload = urlencode(form_data).encode("utf-8")

    headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Cookie": cookie_header,
        "Origin": "https://www.dgft.gov.in",
        "Referer": "https://www.dgft.gov.in/CP/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
        ),
        "X-Requested-With": "XMLHttpRequest",
    }
    if csrf_header_name:
        headers[csrf_header_name] = csrf_token

    request = Request(endpoint, data=encoded_payload, headers=headers, method="POST")

    try:
        with urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, response.headers, body
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return error.code, error.headers, body


def response_has_error(status: int, headers, body: str) -> bool:
    if status >= 400:
        return True

    content_type = headers.get("Content-Type", "").lower()
    if "application/json" in content_type:
        return False

    snippet = body.lstrip().lower()
    return snippet.startswith("<!doctype html") or snippet.startswith("<html")


def print_response(status: int, headers, body: str) -> None:
    print(f"HTTP {status}")
    print(f"Content-Type: {headers.get('Content-Type', '')}")
    print()

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        print(body)
        return

    print(json.dumps(parsed, indent=2))


def main() -> int:
    cookies = load_cookies(COOKIE_FILE)
    status, headers, body = perform_request(cookies, QUERY_PARAMS["_csrf"])

    if response_has_error(status, headers, body):
        try:
            cookies, csrf_token, csrf_header_name = refresh_csrf(cookies)
            status, headers, body = perform_request(
                cookies,
                csrf_token,
                csrf_header_name,
            )
        except (HTTPError, URLError, ValueError) as error:
            print_response(status, headers, body)
            print(f"\nAuto CSRF refresh failed: {error}", file=sys.stderr)
            return 1

    print_response(status, headers, body)
    if response_has_error(status, headers, body):
        print(
            "\nRequest failed. DGFT often returns this when the session cookie or "
            "the `_csrf` token has expired.",
            file=sys.stderr,
        )
        return 1

    try:
        json.loads(body)
        return 0
    except json.JSONDecodeError:
        print("Response was not JSON after retry.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
