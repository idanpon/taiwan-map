#!/usr/bin/env python3
"""Switch only deployment settings; preserve the password hash and database."""
from datetime import datetime
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile


def configure(path, api_origin):
    if not re.fullmatch(r"https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", api_origin):
        raise ValueError("Pass an HTTPS origin without a path, port or trailing slash.")
    text = path.read_text()
    if len(re.findall(r"^APP_PASSWORD_HASH=pbkdf2\$(?:100000|600000)\$[a-f0-9]{32}\$[a-f0-9]{64}$", text, re.M)) != 1:
        raise ValueError("Expected one password hash; file kept unchanged.")
    keys = {"APP_ORIGIN", "FRONTEND_ORIGIN", "AUTH_MODE", "SESSION_COOKIE_PATH", "TRUST_PROXY"}
    lines = [line for line in text.splitlines() if line.split("=", 1)[0].strip() not in keys]
    lines += ["APP_ORIGIN=" + api_origin, "FRONTEND_ORIGIN=https://idanpon.github.io", "AUTH_MODE=bearer", "SESSION_COOKIE_PATH=/api", "TRUST_PROXY=0"]
    backup = Path(str(path) + ".before-pages-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    shutil.copy2(path, backup)
    backup.chmod(0o600)
    fd, name = tempfile.mkstemp(prefix=".taiwan-map.env.", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            output.write("\n".join(lines) + "\n")
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return backup


if __name__ == "__main__":
    if os.geteuid() != 0 or len(sys.argv) != 2:
        sys.exit("Usage as root: python3 server/configure-pages-env.py https://API-HOST")
    try:
        backup = configure(Path("/etc/taiwan-map.env"), sys.argv[1])
    except (ValueError, OSError) as error:
        sys.exit(str(error))
    print("Deployment settings updated; password hash preserved. Restart the API after checking the proxy.")
    print("Private backup:", backup)
