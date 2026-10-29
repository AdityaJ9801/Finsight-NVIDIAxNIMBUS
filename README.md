# FinSight — Multi-Agent Financial Analysis

FinSight turns financial documents into reports, charts, and interactive analysis. Upload balance sheets, income statements, cash flow statements, or bank statements, then use the Virtual CFO assistant to explore the results.

The project combines deterministic financial calculations with AI-generated explanations, document retrieval, and internet-based validation through Tavily MCP.

## Features

- Process financial documents in PDF, Excel, and CSV formats.
- Map accounts and flag uncertain classifications for human review.
- Reconcile financial data before analysis.
- Calculate ratios, trends, working capital metrics, and DuPont decomposition.
- Generate reports with financial charts and supporting tables.
- Ask financial questions through the Virtual CFO assistant.
- Retrieve external context and source references through Tavily MCP.
- Track specialised agents as they execute the analysis pipeline.

## NVIDIA Model Integration

FinSight integrates **NVIDIA NIM** through a shared LLM gateway. The configured NVIDIA model is:

```text
nvidia/nemotron-3.5-super-vl-120b-a12b
```

The integration supports the language-based parts of the application, including financial explanations, report narratives, and Virtual CFO responses.

Financial calculations remain in Python. The model receives calculated metrics and retrieved context to explain the results. Reports insert stored financial values through metric placeholders, helping keep the narrative connected to the underlying data.

### Implementation locations

| Component | Repository location |
|---|---|
| NVIDIA endpoint and model configuration | `backend/app/config.py` |
| Provider selection and gateway creation | `backend/app/llm_gateway/__init__.py` |
| Inference requests and response handling | `backend/app/llm_gateway/client.py` |
| Runtime configuration API | `backend/app/api/llm_config.py` |
| Provider and model settings interface | `frontend/src/pages/Settings.tsx` |
| Virtual CFO question-answering workflow | `backend/app/agents/delivery/ask_langgraph.py` |

## Tavily MCP: Internet-Based Validation

FinSight integrates Tavily MCP to retrieve external information when a question requires evidence beyond the uploaded documents.

The question-answering workflow can combine:

1. Calculated financial metrics.
2. Excerpts retrieved from uploaded documents.
3. Financial diagnostic guidance.
4. External context and source references returned by Tavily.

External search results provide supporting evidence; they do not replace the uploaded financial records or deterministic calculations. If a web lookup fails, the assistant can continue using the available internal data.

## Nebius Token Factory and Other Nebius Services

The implementation documented here uses NVIDIA NIM and Tavily MCP. **Nebius Token Factory usage and other Nebius services have not been verified for this version**, so no workflow acceleration or infrastructure usage is attributed to them.

NVIDIA NIM and Nebius Token Factory are separate services. A configurable inference endpoint alone does not establish that Token Factory was used.

## Architecture

```text
React + TypeScript frontend
            |
         Flask API
            |
     Agent orchestration
            |
   +--------+---------+----------------+
   |                  |                |
Document intake   Financial        Delivery
and extraction    analysis         and Q&A
   |                  |                |
Account mapping   Ratios, trends   Reports, charts,
and reconciliation and risk        Virtual CFO
            |
    Shared LLM gateway
            |
        NVIDIA NIM

Additional context:
- Uploaded document retrieval
- Tavily MCP web validation

Background processing:
- Celery
- Redis
```

Agents run according to their dependencies. Independent tasks can execute concurrently, while dependent tasks wait for the required inputs.

## Technology Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Python 3.12, Flask
- **Agent workflows:** LangChain, LangGraph, custom dependency-based orchestration
- **Financial analysis:** pandas, NumPy, scikit-learn
- **Database:** SQLAlchemy, SQLite/PostgreSQL
- **Background processing:** Celery, Redis
- **AI inference:** NVIDIA NIM
- **External validation:** Tavily MCP
- **Deployment:** Docker, Nginx, Gunicorn

## Setup

### Prerequisites

For the recommended setup:

- Git
- Docker Desktop with Docker Compose
- An NVIDIA API key for live NVIDIA inference
- Tavily credentials for internet-based validation

You can run the application with the offline mock provider before configuring live inference.

### Run with Docker

Clone the repository and open its root directory.

Copy the environment template:

**Windows PowerShell**

```powershell
Copy-Item backend/.env.docker.example backend/.env.docker
```

**Linux/macOS**

```bash
cp backend/.env.docker.example backend/.env.docker
```

Start the application:

```bash
docker compose up --build
```

Open:

- **Web application:** http://localhost:8080
- **Backend API:** http://localhost:5000/api

Upload financial documents or use the sample statements to start an analysis.

Stop the services:

```bash
docker compose down
```

### Configure NVIDIA NIM

Open **Settings → LLM Gateway** in the application:

1. Select **NVIDIA NIM**.
2. Enter your NVIDIA API key.
3. Set the model name available to your account.
4. Save the configuration.

The backend also supports these environment variables:

```dotenv
NVIDIA_API_KEY=your_nvidia_api_key
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL_NAME=nvidia/nemotron-3.5-super-vl-120b-a12b
NVIDIA_REASONING_MODEL_NAME=nvidia/nemotron-3.5-super-vl-120b-a12b
```

Use the NVIDIA provider in Settings to enable live inference. Keep API keys out of committed files.

### Native Development Setup

Requirements:

- Python 3.12
- Node.js and npm
- Redis

From the repository root:

```bash
python -m venv .venv
```

Activate the environment:

**Windows PowerShell**

```powershell
.venv\Scripts\Activate.ps1
```

**Linux/macOS**

```bash
source .venv/bin/activate
```

Install backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env`, then initialise the database:

```bash
flask init-db
```

Start Redis. If using Docker:

```bash
docker run --name finsight-redis -p 6379:6379 redis:alpine
```

Start the following processes in separate terminals.

**Backend — from `backend/`:**

```bash
python run.py
```

**Worker — from `backend/`, with the Python environment activated:**

```bash
celery -A app.workers.celery_app worker --pool=solo -l info
```

**Frontend — from `frontend/`:**

```bash
npm ci
npm run dev
```

Open the frontend at http://localhost:5173.

## Using FinSight

1. Upload financial statements or select the sample data.
2. Start the analysis and follow agent progress.
3. Review flagged mappings or reconciliation issues.
4. Explore the report, metrics, and charts.
5. Ask the Virtual CFO questions about the results.

Example questions:

```text
Summarize the company's financial performance.

Why did EBITDA margin decline?

What is driving the change in working capital?

Show DuPont decomposition in a table.

Which financial risks need further investigation?
```

## Testing

Run backend tests from `backend/`:

```bash
python -m pytest
```

Run the frontend type check from `frontend/`:

```bash
npm run typecheck
```

The backend test configuration uses a fake LLM gateway so tests can exercise application behaviour without live model credentials.

Regression coverage includes question-answering paths where web validation succeeds, fails, or is skipped.

## Updates to the Existing Project

FinSight’s existing document analysis pipeline was extended with:

- NVIDIA NIM integration through the shared LLM gateway.
- Configurable NVIDIA credentials, endpoint, and model settings.
- Tavily MCP integration for external context and validation.
- Multi-source question answering combining financial facts, document excerpts, and web evidence.
- Error handling and regression coverage for optional web-validation paths.

## Limitations

Document extraction and account mapping can require manual review, especially for unfamiliar layouts. Forecasts and diagnostic explanations depend on the quality and completeness of the supplied data. External sources may be incomplete or disagree with uploaded records.

## License

FinSight is released under the **Apache License 2.0**, an **OSI-approved open-source license**. See [LICENSE](LICENSE) for the full terms.

The repository license covers this project’s code. Models, hosted inference services, and third-party dependencies remain subject to their respective licenses and terms.
