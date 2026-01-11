from __future__ import annotations

import argparse

from pipelines.common.config import load_config
from pipelines.common.logging_setup import setup_logging, get_logger
from pipelines.common.ops import run_with_ops
from pipelines.ingestion.geo.load_zip_boundaries import load_zip_boundaries

logger = get_logger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(prog="geo-pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)

    load_zips = sub.add_parser("load-zips", help="Download and load ZCTA ZIP boundaries into RAW")
    load_zips.add_argument(
        "--scope",
        choices=["us", "ca"],
        default="us",
        help="Load scope (us = all ZCTAs, ca = attempt CA-only)",
    )

    args = parser.parse_args()

    setup_logging()
    cfg = load_config()

    if args.cmd == "load-zips":
        def _job():
            return load_zip_boundaries(cfg, scope=args.scope)

        stats = run_with_ops(cfg, job_name=f"geo_load_zips_{args.scope}", fn=_job)
        logger.info("Geo job finished", extra={"stats": stats})


if __name__ == "__main__":
    main()
