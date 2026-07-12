from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LeadCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    company: str | None = Field(default=None, max_length=255)
    message: str = Field(..., min_length=1)


class LeadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    company: str | None
    message: str | None
    status: str
    created_at: datetime
    ai_response: str | None
    qualified_score: int | None


class LeadQualificationResult(BaseModel):
    lead: LeadOut
    qualified_score: int
    ai_response: str


class TelegramApprovalRequest(BaseModel):
    lead_id: int
