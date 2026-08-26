#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  SyncSite — Offline-friendly construction site reporting tool.
  Validate the new Intelligent Specialist Report form end-to-end:
    - Auto-populated header (Date, Name, Puesto, Contract, Contractor)
    - Reference Point picker with "+ Nuevo" creation modal
    - Auto-filled Location & Coordinates from selected point
    - First / Last reading with selectable unit and auto-calculated Avance
    - Free-text Activities (with history suggestions)
    - Personnel + Equipment multi-chip inputs with area-shared autocomplete
    - Existing fields: Title, Comments (+ AI improve), Priority chips, Photos
    - Submit creates report online OR enqueues offline.

backend:
  - task: "Reference Points CRUD (/api/reference-points)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "GET list, POST create (with optional area scoping + dup check), DELETE. Should be tested by an especialista and a coordinador."

  - task: "Site Config (/api/site-config GET + PUT)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "GET returns current contract/contractor. PUT only coordinador."

  - task: "Report History suggestions (/api/report-history)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Returns aggregated personnel/equipment/activities for the calling user's area. Used to power autocomplete in the smart form."

  - task: "Create Report w/ smart fields (POST /api/reports)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Accepts reference_point_id/name, location, coordinates, first/last reading + unit (with auto avance calc), activities text, personnel[], equipment[], priority 1/2/3, images, title, comments."

frontend:
  - task: "Auto-Georreferenciación por Poste (Cero Huella Local)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(especialista)/new.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "El mapa manual fue removido. Al seleccionar Tramo/Estación/Poste, los campos 'Ubicación' y 'Coordenadas' se llenan automáticamente desde /app/frontend/src/utils/posteCoords.ts y son read-only. Aparece un badge 'Auto'. Validar que no se rompe el render, que el badge se muestra al completar Tramo/Estación/Poste, y que ambas inputs están deshabilitadas (editable=false)."

  - task: "Adjuntar Archivo y Escáner cumplen Cero Huella Local"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(especialista)/new.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "pickDocument() y scanDocument() leen base64 en RAM y ejecutan wipeTemp(asset.uri) para borrar la copia temporal del picker. Validar (vía code-review + UI) que el flujo NO depende de almacenamiento persistente y que el botón 'Adjuntar archivo' y 'Escanear' están visibles y son accesibles en el formulario nuevo. Cualquier intento de seleccionar archivo debe terminar con un elemento en files[] (dataUrl base64)."

  - task: "Intelligent Specialist Report form"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(especialista)/new.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Full UI for auto-header, Ref-point picker + create modal, readings/unit/avance, activities textarea, personnel & equipment chip multi-inputs with suggestions, title, comments + AI improve, priority chips, photo gallery, offline-aware submit."

  - task: "Offline queue (sync-context) supports smart fields"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/sync-context.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: "QueuedReport now carries reference_point_*, coordinates, first/last reading, unit, activities, personnel, equipment, priority. syncNow forwards them to api.createReport."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "Reference Points CRUD (/api/reference-points)"
    - "Site Config (/api/site-config GET + PUT)"
    - "Report History suggestions (/api/report-history)"
    - "Create Report w/ smart fields (POST /api/reports)"
    - "Intelligent Specialist Report form"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: "Smart Report form (Specialist) is fully wired to the new backend endpoints. Please run backend tests first using credentials from /app/memory/test_credentials.md (default password demo1234). Then run frontend tests on the Especialista /new screen: login as geotecnia@syncsite.com, open Nuevo reporte, verify auto-header shows Date/Name/Puesto, Reference Point picker opens (empty allowed) and the '+ Nuevo' modal can create a point, readings auto-calc Avance, personnel/equipment chips add/remove and show suggestions if any history exists, photo gallery still works, and submission lands in /reports (use coordinador@syncsite.com to verify report is visible). Also exercise Site Config GET as any user and PUT as coordinador only."
