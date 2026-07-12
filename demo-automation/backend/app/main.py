import logging

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import AIQualificationError, qualify_lead
from app.config import settings
from app.database import Base, engine, get_db
from app.models import Lead
from app.schemas import LeadCreate, LeadOut, LeadQualificationResult, TelegramApprovalRequest
from app.telegram import TelegramNotificationError, send_approval_request

logger = logging.getLogger("lead_qualification")

app = FastAPI(title="Lead Qualification & Auto-Response API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/webhook/lead", response_model=LeadQualificationResult)
async def receive_lead(payload: LeadCreate, db: AsyncSession = Depends(get_db)):
    lead = Lead(
        name=payload.name,
        email=payload.email,
        company=payload.company,
        message=payload.message,
        status="new",
    )
    db.add(lead)
    try:
        await db.commit()
        await db.refresh(lead)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Nie udało się zapisać leada: {exc}") from exc

    try:
        qualified_score, ai_response = await qualify_lead(
            name=lead.name, company=lead.company, message=lead.message or ""
        )
    except AIQualificationError as exc:
        logger.error("Błąd kwalifikacji AI dla leada %s: %s", lead.id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    lead.qualified_score = qualified_score
    lead.ai_response = ai_response
    lead.status = "qualified"

    try:
        await db.commit()
        await db.refresh(lead)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Nie udało się zapisać wyniku AI: {exc}"
        ) from exc

    return LeadQualificationResult(
        lead=LeadOut.model_validate(lead),
        qualified_score=qualified_score,
        ai_response=ai_response,
    )


@app.get("/leads", response_model=list[LeadOut])
async def list_leads(db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Lead).order_by(Lead.created_at.desc()))
        leads = result.scalars().all()
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Nie udało się pobrać leadów: {exc}"
        ) from exc
    return leads


@app.post("/webhook/telegram-approval")
async def telegram_approval(payload: TelegramApprovalRequest, db: AsyncSession = Depends(get_db)):
    lead = await db.get(Lead, payload.lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail=f"Lead {payload.lead_id} nie istnieje")

    try:
        await send_approval_request(lead)
    except TelegramNotificationError as exc:
        logger.error("Błąd wysyłki Telegram dla leada %s: %s", lead.id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"status": "sent", "lead_id": lead.id}
