"""Run the actual Bash healthcheck against Docker/curl doubles, never a server."""
import os
import shutil
import subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
GIT_BASH = Path("C:/Program Files/Git/bin/bash.exe")
BASH = str(GIT_BASH) if GIT_BASH.is_file() else shutil.which("bash")
pytestmark = pytest.mark.skipif(not BASH, reason="Bash is required for deployment script checks")


def run_check(tmp_path, binding, expected, real_curl=False):
    setup = tmp_path / "mock-tools.sh"
    setup.write_text('''
docker() {
    if [[ "$*" == "compose port nginx 80" ]]; then
        printf '%s' "$TEST_BINDING"
    elif [[ "$*" == "compose exec -T "* ]]; then
        return 0
    else
        echo "Unexpected Docker operation" >&2; return 99
    fi
}
curl() {
    local url="${!#}"
    printf '%s\\n' "$url" >> "$TEST_CURL_LOG"
    if [[ "$url" != "$TEST_EXPECTED_URL/"* || "$url" == *$'\\n'* || "$url" == *$'\\r'* ]]; then
        echo 'curl: (3) URL rejected: Malformed input to a URL function' >&2
        return 3
    fi
    if [[ "$TEST_REAL_CURL" == 1 ]]; then command curl "$@"; return; fi
    printf '<script type="module" src="/assets/verified.js"></script>\\n'
}
''', encoding="utf-8", newline="\n")
    log = tmp_path / "curl-urls.txt"
    result = subprocess.run([BASH, "scripts/healthcheck.sh"], cwd=ROOT,
        env={**os.environ, "BASH_ENV": setup.as_posix(), "TEST_BINDING": binding,
             "TEST_CURL_LOG": log.as_posix(), "TEST_EXPECTED_URL": expected,
             "TEST_REAL_CURL": "1" if real_curl else "0", "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"},
        capture_output=True, text=True, encoding="utf-8", timeout=20)
    urls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return result, urls


@pytest.mark.parametrize("binding,expected", [
    ("0.0.0.0:8080\n", "http://127.0.0.1:8080"),
    ("0.0.0.0:8080\n[::]:8080\n", "http://127.0.0.1:8080"),
    ("[::]:8080\n0.0.0.0:8080\n", "http://127.0.0.1:8080"),
    ("127.0.0.1:15175\n", "http://127.0.0.1:15175"),
    ("[::]:8080\n", "http://[::1]:8080"),
    (":::8080\n", "http://[::1]:8080"),
    ("[::1]:8080\n", "http://[::1]:8080"),
    ("[2001:db8::1]:8080\n", "http://[2001:db8::1]:8080"),
    ("0.0.0.0:8080\r\n[::]:8080\r\n", "http://127.0.0.1:8080"),
    ("\n0.0.0.0:8080\n", "http://127.0.0.1:8080"),
])
def test_healthcheck_uses_one_valid_url_for_all_endpoints_and_asset(tmp_path, binding, expected):
    result, urls = run_check(tmp_path, binding, expected)
    assert result.returncode == 0, result.stdout + result.stderr
    assert urls == [expected+path for path in (
        "/", "/health/live", "/health/ready", "/api/v1/forms/current", "/", "/assets/verified.js")]
    assert "OK frontend asset, migration, worker" in result.stdout


@pytest.mark.parametrize("binding", ["", "not-a-binding", "0.0.0.0:0", "0.0.0.0:99999"])
def test_healthcheck_rejects_missing_or_invalid_binding_before_curl(tmp_path, binding):
    result, urls = run_check(tmp_path, binding, "unused")
    assert result.returncode != 0
    assert not urls
    assert "nginx" in result.stderr and "curl: (3)" not in result.stderr


def test_dualstack_probe_fetches_endpoints_and_asset_with_real_curl(tmp_path):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'<script type="module" src="/assets/verified.js"></script>')

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    try:
        result, urls = run_check(tmp_path, f"0.0.0.0:{port}\n[::]:{port}\n", f"http://127.0.0.1:{port}", real_curl=True)
        assert result.returncode == 0, result.stdout + result.stderr
        assert len(urls) == 6
        assert requests == ["/", "/health/live", "/health/ready", "/api/v1/forms/current", "/", "/assets/verified.js"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
