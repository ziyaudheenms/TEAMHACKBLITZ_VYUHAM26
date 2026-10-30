# Meetings & Minutes Hub API Specification

**Base Route:** `/api/v1/meetings`  
**Security & Access Control:** Bearer JWT required. Multi-tenant organisation scoping and tenant isolation enforced on every request.  
**Reference:** `FRONTEND_API_CONTRACT.md` Section 2.7, Migration `006_meetings_and_action_items.sql`, and `modules/meetings`.

---

## 1. Overview & Architecture

The `/api/v1/meetings` endpoint group provides the enterprise Meeting Hub and Minutes pipeline for BizContext AI.

### Core Capabilities
1. **Meeting Records & Minutes Management:**
   - Captures meeting title, agenda, scheduled date/time, duration in minutes, attendees, and project associations.
   - Preserves raw meeting minutes, audio transcription notes, and OCR extracted texts.
2. **AI Action Item & Executive Summary Extractor:**
   - Uses the AI Engine (`aiEngineClient.runAgent` with `meeting_secretary` system prompt) to analyze raw transcripts and OCR notes.
   - Returns a structured 2–3 sentence executive summary and actionable follow-up items with assignee names, estimated deadlines, and priority levels.
   - Provides an intelligent heuristic NLP fallback parser if the AI engine is unreachable or offline, guaranteeing zero-downtime operation.
3. **One-Click Kanban Task Conversion:**
   - Any extracted action item can be converted into an active task in the Kanban board (`/tasks`), syncing status and linking `task_id`.
4. **Audit Trail & Activity Logging:**
   - Creation, action item extraction, task conversion, and deletions generate persistent entries in `audit_logs`.

---

## 2. Endpoints

### 2.1 List Meetings
- **`GET /api/v1/meetings`**
- **Query Parameters:**
  - `page` (number, default: 1)
  - `limit` (number, default: 50)
  - `projectId` (UUID, optional)
  - `search` (string, optional — searches title, agenda, and minutes content)
- **Response (200 OK):**
  ```json
  [
    {
      "id": "meet-1",
      "organisationId": "00000000-0000-0000-0000-000000000001",
      "createdBy": "emp-1",
      "createdAt": "2026-10-29T14:00:00.000Z",
      "updatedAt": "2026-10-30T10:00:00.000Z",
      "title": "Sprint 26 Architecture & AI Governance Sync",
      "agenda": "Review browser agent sandboxing (B0-B4), vector search latency benchmarks, and meeting OCR action item pipeline.",
      "meetingDate": "2026-10-29 14:00",
      "durationMinutes": 45,
      "participantIds": ["emp-1", "emp-2", "emp-3"],
      "participantNames": ["Adhwaithas S.", "Priya Sharma", "Marcus Vance"],
      "projectId": "proj-1",
      "projectName": "BizContext Web Core V1",
      "minutesContent": "Marcus flagged the risk of B3/B4 browser agents: We cannot allow autonomous form submission without explicit human-in-the-loop approval drawers.",
      "aiSummary": "The team agreed on strict B3/B4 human-in-the-loop approval workflows, validated pgvector search performance, and scheduled immediate task assignments.",
      "extractedActionItems": [
        {
          "id": "act-1",
          "title": "Integrate B3 human approval drawer into Browser Jobs interface",
          "assignee": "Elena Rostova",
          "dueDate": "2026-10-31",
          "priority": "urgent",
          "convertedToTask": true,
          "taskId": "task-101"
        }
      ]
    }
  ]
  ```

---

### 2.2 Create Meeting Record
- **`POST /api/v1/meetings`**
- **Request Body:**
  ```json
  {
    "title": "Sprint 26 Architecture & AI Governance Sync",
    "agenda": "Review browser agent sandboxing and OCR action items.",
    "meetingDate": "2026-10-30 14:00",
    "durationMinutes": 45,
    "projectId": "00000000-0000-0000-0000-000000000001",
    "participantNames": ["Adhwaithas S.", "Priya Sharma", "Marcus Vance"],
    "minutesContent": "Discussion notes or OCR transcript..."
  }
  ```
- **Response (201 Created):** Full created `Meeting` object.

---

### 2.3 Get Meeting Details
- **`GET /api/v1/meetings/:id`**
- **Response (200 OK):** Single `Meeting` object with populated `extractedActionItems` and project name.

---

### 2.4 Update Meeting Record
- **`PATCH /api/v1/meetings/:id`**
- **Request Body:**
  ```json
  {
    "title": "Updated Meeting Title",
    "minutesContent": "Updated meeting transcript with additional discussions...",
    "durationMinutes": 60
  }
  ```
- **Response (200 OK):** Updated `Meeting` object.

---

### 2.5 Delete Meeting Record (Soft Delete)
- **`DELETE /api/v1/meetings/:id`**
- **Response (200 OK):**
  ```json
  {
    "success": true
  }
  ```

---

### 2.6 Extract Action Items (AI Engine & Heuristic Fallback)
- **`POST /api/v1/meetings/:id/extract-action-items`**
- **Request Body (Optional):**
  ```json
  {
    "minutesContent": "Optional updated transcript to parse",
    "forceRegenerate": false
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "id": "meet-1",
    "title": "Sprint 26 Architecture & AI Governance Sync",
    "aiSummary": "Executive summary synthesized by AI model...",
    "extractedActionItems": [
      {
        "id": "act-1",
        "title": "Deploy iptables domain filtering rulebook to staging worker node",
        "assignee": "Marcus Vance",
        "dueDate": "2026-11-03",
        "priority": "urgent",
        "convertedToTask": false
      },
      {
        "id": "act-2",
        "title": "Validate HyDE query expansion prompt with pgvector top-k results",
        "assignee": "Priya Sharma",
        "dueDate": "2026-11-04",
        "priority": "high",
        "convertedToTask": false
      }
    ]
  }
  ```

---

### 2.7 Convert Action Item to Kanban Task
- **`POST /api/v1/meetings/:id/action-items/:actionId/convert-to-task`**
- **Request Body (Optional overrides):**
  ```json
  {
    "projectId": "00000000-0000-0000-0000-000000000001",
    "status": "open"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "task": {
      "id": "task-205",
      "title": "Deploy iptables domain filtering rulebook to staging worker node",
      "status": "open",
      "priority": "urgent",
      "assigneeName": "Marcus Vance",
      "dueDate": "2026-11-03T00:00:00.000Z"
    },
    "actionItemId": "act-1"
  }
  ```

---

## 3. Database Schema

Managed via migrations:
- `001_initial_schema.sql`: Base `meetings` table.
- `006_meetings_and_action_items.sql`: Extends `meetings` with duration, JSONB participant arrays, AI summary, soft delete, and creates `meeting_action_items` table linked to `tasks(id)`.
