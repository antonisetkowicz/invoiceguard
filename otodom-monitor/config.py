"""Wczytywanie i walidacja config.yaml."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG_PATH = Path(__file__).with_name("config.yaml")


class ConfigError(Exception):
    pass


def _get(data: dict[str, Any], path: str, default: Any = None) -> Any:
    """Odczyt zagnieżdżonego klucza po ścieżce 'a.b.c'."""
    node: Any = data
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return default if node is None else node


@dataclass
class PortalProfile:
    """Wszystko, co zależy od konkretnego serwisu ogłoszeniowego."""

    key: str
    name: str
    base_url: str
    offer_url_template: str
    offer_id_pattern: str
    pagination_param: str
    next_data_enabled: bool
    next_data_script_id: str
    list_paths: list[str]
    detail_paths: list[str]
    selectors: dict[str, str]
    image_url_rules: list[dict[str, str]]
    image_keys: list[str]

    def selector(self, key: str) -> str:
        value = (self.selectors.get(key) or "").strip()
        if value.upper() == "TODO":
            return ""
        return value


@dataclass
class Config:
    path: Path
    root: Path
    portal: PortalProfile

    search_url: str
    max_offers_per_run: int
    max_pages: int
    fetch_details: bool

    headless: bool
    user_agent: str
    locale: str
    timezone: str
    viewport: dict[str, int]
    min_delay: float
    max_delay: float
    page_timeout_ms: int
    navigation_retries: int
    accept_cookies: bool
    executable_path: str

    download_images: bool
    max_images_per_offer: int
    overwrite_images: bool
    image_timeout_ms: int
    image_min_delay: float
    image_max_delay: float

    db_path: Path
    images_dir: Path
    reports_dir: Path
    debug_dir: Path

    interval_minutes: int
    missing_runs_threshold: int
    write_markdown: bool
    skip_report_when_no_changes: bool
    webhook: dict[str, Any]

    blocking_markers: list[str]
    blocking_statuses: list[int]

    raw: dict[str, Any] = field(default_factory=dict)


def _resolve(root: Path, value: str) -> Path:
    p = Path(value).expanduser()
    return p if p.is_absolute() else (root / p).resolve()


def load_config(path: str | Path | None = None) -> Config:
    cfg_path = Path(path or DEFAULT_CONFIG_PATH).expanduser().resolve()
    if not cfg_path.exists():
        raise ConfigError(f"Brak pliku konfiguracyjnego: {cfg_path}")

    with cfg_path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ConfigError(f"{cfg_path} nie zawiera mapy YAML")

    root = cfg_path.parent
    portal_key = data.get("portal") or "otodom"
    portals = data.get("portals") or {}
    if portal_key not in portals:
        raise ConfigError(
            f"Profil portalu '{portal_key}' nie istnieje. Dostępne: {', '.join(portals) or 'brak'}"
        )
    pdata = portals[portal_key] or {}

    profile = PortalProfile(
        key=portal_key,
        name=pdata.get("name", portal_key),
        base_url=(pdata.get("base_url") or "").rstrip("/"),
        offer_url_template=pdata.get("offer_url_template", ""),
        offer_id_pattern=pdata.get("offer_id_pattern", ""),
        pagination_param=pdata.get("pagination_param", "page"),
        next_data_enabled=bool(_get(pdata, "next_data.enabled", False)),
        next_data_script_id=_get(pdata, "next_data.script_id", "__NEXT_DATA__"),
        list_paths=list(_get(pdata, "next_data.list_paths", []) or []),
        detail_paths=list(_get(pdata, "next_data.detail_paths", []) or []),
        selectors=dict(pdata.get("selectors") or {}),
        image_url_rules=list(pdata.get("image_url_rules") or []),
        image_keys=list(pdata.get("image_keys") or ["large", "url"]),
    )

    search_url = _get(data, "search.url", "")
    if not search_url:
        raise ConfigError("search.url jest wymagany — wklej link z wynikami wyszukiwania")

    min_delay = float(_get(data, "scraping.min_delay_seconds", 2.0))
    max_delay = float(_get(data, "scraping.max_delay_seconds", 5.0))
    if min_delay < 0 or max_delay < min_delay:
        raise ConfigError("scraping.min_delay_seconds / max_delay_seconds: nieprawidłowy przedział")
    if min_delay < 1.0:
        raise ConfigError(
            "scraping.min_delay_seconds < 1 s — to narzędzie celowo nie pozwala "
            "na agresywne odpytywanie portalu"
        )

    cfg = Config(
        path=cfg_path,
        root=root,
        portal=profile,
        search_url=search_url,
        max_offers_per_run=int(_get(data, "search.max_offers_per_run", 40)),
        max_pages=int(_get(data, "search.max_pages", 3)),
        fetch_details=bool(_get(data, "search.fetch_details", True)),
        headless=bool(_get(data, "scraping.headless", True)),
        user_agent=_get(data, "scraping.user_agent", ""),
        locale=_get(data, "scraping.locale", "pl-PL"),
        timezone=_get(data, "scraping.timezone", "Europe/Warsaw"),
        viewport=dict(_get(data, "scraping.viewport", {"width": 1440, "height": 900})),
        min_delay=min_delay,
        max_delay=max_delay,
        page_timeout_ms=int(_get(data, "scraping.page_timeout_ms", 30000)),
        navigation_retries=int(_get(data, "scraping.navigation_retries", 2)),
        accept_cookies=bool(_get(data, "scraping.accept_cookies", True)),
        executable_path=str(_get(data, "scraping.executable_path", "") or ""),
        download_images=bool(_get(data, "images.download", True)),
        max_images_per_offer=int(_get(data, "images.max_per_offer", 30)),
        overwrite_images=bool(_get(data, "images.overwrite", False)),
        image_timeout_ms=int(_get(data, "images.timeout_ms", 30000)),
        image_min_delay=float(_get(data, "images.min_delay_seconds", 0.3)),
        image_max_delay=float(_get(data, "images.max_delay_seconds", 0.8)),
        db_path=_resolve(root, _get(data, "storage.database_path", "./data/offers.db")),
        images_dir=_resolve(root, _get(data, "storage.images_dir", "./images")),
        reports_dir=_resolve(root, _get(data, "storage.reports_dir", "./reports")),
        debug_dir=_resolve(root, _get(data, "storage.debug_dir", "./debug")),
        interval_minutes=int(_get(data, "watch.interval_minutes", 180)),
        missing_runs_threshold=max(1, int(_get(data, "watch.mark_removed_after_missing_runs", 2))),
        write_markdown=bool(_get(data, "watch.write_markdown", True)),
        skip_report_when_no_changes=bool(_get(data, "watch.skip_report_when_no_changes", True)),
        webhook=dict(_get(data, "watch.webhook", {}) or {}),
        blocking_markers=[str(m).lower() for m in _get(data, "blocking.markers", []) or []],
        blocking_statuses=[int(s) for s in _get(data, "blocking.http_statuses", []) or []],
        raw=data,
    )

    if not cfg.portal.selector("list_item") and not cfg.portal.next_data_enabled:
        raise ConfigError(
            f"Profil '{portal_key}': brak zarówno next_data.enabled, jak i selektora "
            "list_item — nie ma z czego wyciągnąć ofert"
        )
    return cfg
