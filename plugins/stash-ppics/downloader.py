import os
import ssl
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


class Downloader:
    def __init__(self):
        self.ssl_context = ssl._create_unverified_context()
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/138.0.0.0 Safari/537.36"
            ),
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Referer": "https://www.pornpics.com/"
        }

    def filename_from_url(self, url):
        parsed = urlparse(url)
        filename = Path(parsed.path).name.strip()

        if not filename:
            filename = "image.jpg"

        return filename

    def download(self, url, destination):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)

        if destination.exists() and destination.stat().st_size > 0:
            return {
                "path": str(destination),
                "downloaded": False,
                "size": destination.stat().st_size
            }

        request = Request(url, headers=self.headers)
        temp_path = destination.with_name(destination.name + ".part")

        try:
            with urlopen(
                request,
                context=self.ssl_context,
                timeout=60
            ) as response:
                with open(temp_path, "wb") as output:
                    while True:
                        chunk = response.read(1024 * 1024)

                        if not chunk:
                            break

                        output.write(chunk)

            if not temp_path.exists() or temp_path.stat().st_size == 0:
                raise RuntimeError("Downloaded file is empty")

            os.replace(temp_path, destination)

            return {
                "path": str(destination),
                "downloaded": True,
                "size": destination.stat().st_size
            }

        except Exception:
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except OSError:
                pass

            raise
