from pydantic import computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "Reporting RH"
    ENV: str = "dev"  # dev | test | prod
    API_PREFIX: str = "/api/v1"
    COOKIE_PATH_PREFIX: str = ""  # "/reporting-rh" derrière nginx

    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "reporting_rh"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = "reporting_rh"
    DATABASE_URL: str | None = None  # prioritaire sur les champs POSTGRES_*

    SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 7
    COOKIE_SECURE: bool = True

    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def db_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"postgresql+psycopg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @model_validator(mode="after")
    def _secrets_en_prod(self) -> "Settings":
        if self.ENV == "prod" and len(self.SECRET_KEY) < 32:
            raise ValueError("SECRET_KEY (32 caractères minimum) obligatoire en production")
        return self


settings = Settings()
