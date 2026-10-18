import tempfile
import unittest
from pathlib import Path

from native_boundary_fixture import write_boundary_library


class BoundaryFixtureTests(unittest.TestCase):
    def test_exact_size_keeps_records_on_both_sides_of_closed_padding(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic 引用.bib"
            first = "@article{first,title={Synthetic 引用}}\n"
            last = "@article{last,title={Synthetic ending}}\n"
            write_boundary_library(path, first, last, limit=4096)
            data = path.read_bytes()
            self.assertEqual(len(data), 4096)
            self.assertTrue(data.startswith(first.encode("utf-8") + b"\n@comment{"))
            self.assertTrue(data.endswith(b"}\n" + last.encode("utf-8")))
            self.assertEqual(data.decode("utf-8").count("@article{"), 2)
            self.assertEqual(data.count(b"@comment{"), 1)

    def test_oversized_records_do_not_replace_an_existing_fixture(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.bib"
            path.write_bytes(b"owned existing fixture")
            with self.assertRaisesRegex(ValueError, "fit"):
                write_boundary_library(path, "@article{first}\n", "@article{last}\n", limit=20)
            self.assertEqual(path.read_bytes(), b"owned existing fixture")


if __name__ == "__main__":
    unittest.main()
