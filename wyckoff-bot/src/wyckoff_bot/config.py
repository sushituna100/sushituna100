"""Load a StrategyConfig from a YAML or JSON file.

JSON works with the standard library alone. YAML requires PyYAML (an optional
dependency: ``pip install wyckoff-bot[yaml]``). Any field omitted from the file
keeps its dataclass default, so a config file only needs the knobs you want to
change.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from . import wyckoff as wy
from .signals import SignalConfig
from .risk import RiskConfig
from .strategy import StrategyConfig


def _apply(obj: Any, values: Dict[str, Any]) -> None:
    for key, val in (values or {}).items():
        if hasattr(obj, key):
            setattr(obj, key, val)
        else:
            raise ValueError(f"unknown config key '{key}' for {type(obj).__name__}")


def strategy_config_from_dict(data: Dict[str, Any]) -> StrategyConfig:
    cfg = StrategyConfig()
    _apply(cfg.wyckoff, data.get("wyckoff", {}))
    _apply(cfg.signal, data.get("signal", {}))
    _apply(cfg.risk, data.get("risk", {}))
    for key in ("allow_short", "entry_slippage", "max_plans"):
        if key in data:
            setattr(cfg, key, data[key])
    return cfg


def universe_from_dict(data: Dict[str, Any]) -> List[str]:
    return list(data.get("universe", []))


def load_config(path: str) -> Dict[str, Any]:
    if path.endswith((".yaml", ".yml")):
        try:
            import yaml  # type: ignore
        except ImportError as exc:  # pragma: no cover - depends on env
            raise SystemExit(
                "PyYAML is required to read YAML configs "
                "(pip install 'wyckoff-bot[yaml]'), or use a .json config."
            ) from exc
        with open(path) as fh:
            return yaml.safe_load(fh) or {}
    with open(path) as fh:
        return json.load(fh)
