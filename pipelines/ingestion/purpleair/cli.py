from __future__ import annotations

import argparse

from pipelines.common.config import load_config
from pipelines.common.logging_setup import setup_logging, get_logger
from pipelines.common.ops import run_with_ops
from pipelines.ingestion.purpleair.load_raw import load_raw_purpleair

logger = get_logger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(prog="purpleair-pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("load-raw", help="Fetch PurpleAir readings and write RAW table")

    args = parser.parse_args()

    setup_logging()
    cfg = load_config()

    if args.cmd == "load-raw":
        def _job():
            stats = load_raw_purpleair(cfg)
            return stats

        stats = run_with_ops(cfg, job_name="purpleair_load_raw", fn=_job)
        logger.info("Job finished", extra={"stats": stats})


if __name__ == "__main__":
    main()
