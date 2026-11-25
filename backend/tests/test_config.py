"""Hosting settings: database URLs from Render-style providers and comma-separated CORS origins."""
from app.core.config import Settings


def test_render_style_database_urls_get_the_psycopg_driver():
    assert Settings(database_url="postgres://u:p@host:5432/db").database_url == "postgresql+psycopg://u:p@host:5432/db"
    assert Settings(database_url="postgresql://u:p@host/db").database_url == "postgresql+psycopg://u:p@host/db"
    assert Settings(database_url="postgresql+psycopg://u:p@host/db").database_url == "postgresql+psycopg://u:p@host/db"
    assert Settings(database_url="sqlite:///x.db").database_url == "sqlite:///x.db"


def test_cors_origins_accept_a_comma_separated_list_or_json(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://kpc-web.onrender.com/, http://localhost:5173")
    assert Settings().cors_origins == ["https://kpc-web.onrender.com", "http://localhost:5173"]
    monkeypatch.setenv("CORS_ORIGINS", '["https://a.example"]')
    assert Settings().cors_origins == ["https://a.example"]
