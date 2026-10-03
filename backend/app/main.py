from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.budgets import router as budgets_router
from app.api.donnees import router as donnees_router
from app.api.health import router as health_router
from app.api.imports import router as imports_router
from app.api.parametrage import router as parametrage_router
from app.api.periodes import router as periodes_router
from app.api.rapports import router as rapports_router
from app.api.salaries import router as salaries_router
from app.core.config import settings

app = FastAPI(
    title=settings.APP_NAME,
    docs_url=None if settings.ENV == "prod" else "/docs",
    redoc_url=None,
    openapi_url=None if settings.ENV == "prod" else "/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)
app.include_router(health_router)
app.include_router(auth_router, prefix=settings.API_PREFIX)
app.include_router(admin_router, prefix=settings.API_PREFIX)
app.include_router(imports_router, prefix=settings.API_PREFIX)
app.include_router(periodes_router, prefix=settings.API_PREFIX)
app.include_router(parametrage_router, prefix=settings.API_PREFIX)
app.include_router(budgets_router, prefix=settings.API_PREFIX)
app.include_router(rapports_router, prefix=settings.API_PREFIX)
app.include_router(salaries_router, prefix=settings.API_PREFIX)
app.include_router(donnees_router, prefix=settings.API_PREFIX)
