SHELL := /bin/bash

.PHONY: help lint fmt fmt-check test ci clean

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

lint: ## Run lint checks (ruff)
	ruff check .

fmt: ## Auto-format code (ruff)
	ruff format .

fmt-check: ## Check formatting only (ruff)
	ruff format --check .

test: ## Run Python tests
	pytest

ci: lint fmt-check test ## Run the same checks as CI locally

clean: ## Remove Python cache artifacts
	rm -rf .pytest_cache __pycache__ **/__pycache__ .coverage htmlcov
