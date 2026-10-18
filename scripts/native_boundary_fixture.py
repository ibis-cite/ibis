"""Write a new owned synthetic library with records at both ends of a size limit."""
from pathlib import Path


FILE_LIMIT = 64 * 1024 * 1024


def write_boundary_library(path: Path, first: str, last: str, *, limit=FILE_LIMIT):
    start = first.encode("utf-8") + b"\n@comment{"
    end = b"}\n" + last.encode("utf-8")
    remaining = limit - len(start) - len(end)
    if remaining < 0:
        raise ValueError("Synthetic records do not fit inside the file limit")
    # Padding is plain ASCII with no braces or entry markers. Write bounded
    # chunks so producing a 64 MiB fixture does not allocate another 64 MiB.
    chunk = b"x" * min(remaining, 1024 * 1024)
    with path.open("xb") as output:
        output.write(start)
        while remaining:
            size = min(remaining, len(chunk))
            output.write(chunk[:size])
            remaining -= size
        output.write(end)
