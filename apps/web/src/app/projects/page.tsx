"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  FolderKanban,
  Plus,
  User,
  CheckSquare,
  AlertCircle,
  Loader2,
  RefreshCw,
  Calendar,
  X,
} from "lucide-react";
import { api } from "../../services/api";
import { ApiError } from "../../services/http";
import { Project, Task, EmployeeProfile } from "../../types";

const COLUMNS: Array<{ id: Task["status"]; title: string; color: string; badge: string }> = [
  { id: "open", title: "Open / Backlog", color: "border-[#EDEDED] bg-[#EDEDED]/50", badge: "bg-white text-[#262626] border border-[#BEBEBE]" },
  { id: "in_progress", title: "In Progress", color: "border-[#75A0C9]/40 bg-[#75A0C9]/10", badge: "bg-[#75A0C9]/25 text-[#1F456E] border border-[#75A0C9]/40" },
  { id: "in_review", title: "In Review", color: "border-[#F09363]/40 bg-[#F09363]/10", badge: "bg-[#F09363]/25 text-[#843209] border border-[#F09363]/40" },
  { id: "blocked", title: "Blocked", color: "border-rose-200 bg-rose-50", badge: "bg-rose-100 text-rose-800 border border-rose-200" },
  { id: "done", title: "Completed", color: "border-[#74D96F]/40 bg-[#74D96F]/10", badge: "bg-[#74D96F]/25 text-[#1F541D] border border-[#74D96F]/40" },
];

const CANCELLED_COLUMN: { id: Task["status"]; title: string; color: string; badge: string } = {
  id: "cancelled",
  title: "Cancelled",
  color: "border-[#BEBEBE]/50 bg-[#F8F9FA]",
  badge: "bg-white text-[#666666] border border-[#BEBEBE]",
};

const PROJECT_STATUSES: Array<Project["status"]> = ["planning", "active", "paused", "completed"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.status === 0 ? "Cannot reach the server. Check that the API is running and try again." : err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Returns null for empty/invalid values so callers can hide the date instead of rendering "Invalid Date". */
function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function ProjectsKanbanPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  // Loading / error state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const [projectFormError, setProjectFormError] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = useState<Task["status"] | null>(null);

  // Form states for new task
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskProjectId, setTaskProjectId] = useState("");
  const [taskAssigneeUserId, setTaskAssigneeUserId] = useState("");
  const [taskPriority, setTaskPriority] = useState<Task["priority"]>("medium");
  const [taskDueDate, setTaskDueDate] = useState("");

  // Form states for new project
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStatus, setProjectStatus] = useState<Project["status"]>("active");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [p, t] = await Promise.all([api.getProjects(), api.getTasks()]);
      setProjects(p);
      setTasks(t);
    } catch (err) {
      setLoadError(errorMessage(err, "Failed to load projects and tasks."));
      setIsLoading(false);
      return;
    }
    // The directory is only needed for assignment; a failure must not hide the board.
    try {
      setEmployees(await api.getEmployees());
      setEmployeesError(null);
    } catch (err) {
      setEmployees([]);
      setEmployeesError(errorMessage(err, "Could not load the employee directory."));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Read ?taskId= from URL to highlight card when navigated from AI chat
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tid = params.get("taskId");
      if (tid) {
        setHighlightedTaskId(tid);
        const timer = setTimeout(() => {
          const el = document.getElementById(`task-card-${tid}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [tasks]);

  // If the selected project disappears after a reload, fall back to "all".
  useEffect(() => {
    if (selectedProjectId !== "all" && !projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId("all");
    }
  }, [projects, selectedProjectId]);

  // Progress is derived from the task list so it stays correct after optimistic moves.
  const projectStats = useMemo(() => {
    const stats = new Map<string, { total: number; done: number }>();
    for (const t of tasks) {
      if (!t.projectId) continue;
      const s = stats.get(t.projectId) ?? { total: 0, done: 0 };
      s.total += 1;
      if (t.status === "done") s.done += 1;
      stats.set(t.projectId, s);
    }
    return stats;
  }, [tasks]);

  const progressFor = (projectId: string) => {
    const s = projectStats.get(projectId);
    return s && s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
  };

  const assignableEmployees = useMemo(
    () => employees.filter((e) => UUID_RE.test(e.userId) && e.employmentStatus !== "offboarded"),
    [employees]
  );

  const setPending = (taskId: string, pending: boolean) =>
    setPendingTaskIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(taskId);
      else next.delete(taskId);
      return next;
    });

  const handleStatusChange = async (taskId: string, newStatus: Task["status"]) => {
    const original = tasks.find((t) => t.id === taskId);
    if (!original || original.status === newStatus || pendingTaskIds.has(taskId)) return;
    const previousStatus = original.status;

    setActionError(null);
    setPending(taskId, true);
    // Optimistic move.
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));

    try {
      const updated = await api.updateTaskStatus(taskId, newStatus);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      // Roll back just this task so concurrent moves are unaffected.
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: previousStatus } : t)));
      setActionError(`Could not move "${original.title}": ${errorMessage(err, "Failed to update task status.")}`);
    } finally {
      setPending(taskId, false);
    }
  };

  const handleTaskDragStart = (event: React.DragEvent<HTMLDivElement>, task: Task) => {
    if (pendingTaskIds.has(task.id)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    setDraggedTaskId(task.id);
    setActionError(null);
  };

  const finishTaskDrag = () => {
    setDraggedTaskId(null);
    setDropTargetStatus(null);
  };

  const handleTaskDrop = (event: React.DragEvent<HTMLDivElement>, status: Task["status"]) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
    finishTaskDrag();
    if (taskId) void handleStatusChange(taskId, status);
  };

  const openTaskModal = () => {
    setTaskFormError(null);
    setTaskProjectId(selectedProjectId !== "all" ? selectedProjectId : "");
    setIsTaskModalOpen(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingTask || !taskTitle.trim()) return;

    setIsCreatingTask(true);
    setTaskFormError(null);
    try {
      const created = await api.createTask({
        title: taskTitle.trim(),
        description: taskDescription.trim() || undefined,
        projectId: UUID_RE.test(taskProjectId) ? taskProjectId : undefined,
        // The backend stores the auth user id, so send the employee's userId (not the employee row id).
        primaryAssigneeId: UUID_RE.test(taskAssigneeUserId) ? taskAssigneeUserId : undefined,
        priority: taskPriority,
        status: "open",
        dueDate: taskDueDate ? `${taskDueDate}T00:00:00.000Z` : undefined,
      });

      setTasks((prev) => [created, ...prev]);
      setIsTaskModalOpen(false);
      setTaskTitle("");
      setTaskDescription("");
      setTaskAssigneeUserId("");
      setTaskDueDate("");
    } catch (err) {
      setTaskFormError(errorMessage(err, "Failed to create task."));
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingProject || !projectName.trim()) return;

    setIsCreatingProject(true);
    setProjectFormError(null);
    try {
      const created = await api.createProject({
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
        status: projectStatus,
      });

      setProjects((prev) => [...prev, created]);
      setIsProjectModalOpen(false);
      setProjectName("");
      setProjectDescription("");
      setProjectStatus("active");
    } catch (err) {
      setProjectFormError(errorMessage(err, "Failed to create project."));
    } finally {
      setIsCreatingProject(false);
    }
  };

  const filteredTasks =
    selectedProjectId === "all"
      ? tasks
      : tasks.filter((t) => t.projectId === selectedProjectId);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const cancelledCount = filteredTasks.filter((t) => t.status === "cancelled").length;
  const columns = showCancelled ? [...COLUMNS, CANCELLED_COLUMN] : COLUMNS;

  return (
    <div className="space-y-6">
      {/* Top Controls Header matching screenshot aesthetic */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E8ECE9]">
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-2xl bg-[#74D96F]/15 border border-[#74D96F]/30 flex items-center justify-center text-[#1F541D] shadow-xs shrink-0">
            <FolderKanban className="w-5 h-5 text-[#56BE51]" />
          </div>
          <div>
            <div className="text-[10px] font-extrabold tracking-widest text-[#56BE51] uppercase mb-0.5">
              PROJECTS & KANBAN
            </div>
            <h1 className="text-xl md:text-2xl font-black text-[#262626] tracking-tight">
              Projects & Kanban Operations
            </h1>
            <p className="text-xs text-[#666666]">
              Interactive 5-column Kanban board • Real-time task dispatching • Cross-functional initiative delivery
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => void load()}
            disabled={isLoading}
            aria-label="Refresh projects"
            className="p-2.5 rounded-full border border-[#DCE4E0] bg-white hover:bg-[#EDEDED] text-[#52665F] transition disabled:opacity-50 cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => {
              setProjectFormError(null);
              setIsProjectModalOpen(true);
            }}
            disabled={isLoading || !!loadError}
            className="px-4 py-2.5 rounded-full bg-white hover:bg-[#F8FAF9] text-[#262626] text-xs font-bold border border-[#DCE4E0] hover:border-[#74D96F] shadow-2xs transition disabled:opacity-50 cursor-pointer"
          >
            + New Project
          </button>
          <button
            onClick={openTaskModal}
            disabled={isLoading || !!loadError}
            className="px-5 py-2.5 rounded-full bg-[#0D382E] hover:bg-[#124B3E] active:scale-95 text-white text-xs font-bold shadow-md shadow-[#0D382E]/25 transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#74D96F]" />
            <span>Create Task</span>
          </button>
        </div>
      </div>

      {/* Load error */}
      {loadError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
        >
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="inline-flex items-center space-x-1 shrink-0 px-3 py-1 rounded-full bg-white border border-rose-200 font-semibold hover:bg-rose-100 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Mutation error (e.g. failed status move, rolled back) */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
        >
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="shrink-0 p-0.5 rounded-full hover:bg-rose-100 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {employeesError && !loadError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Task assignment is unavailable: {employeesError}</span>
          </div>
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="inline-flex items-center space-x-1 shrink-0 px-3 py-1 rounded-full bg-white border border-amber-200 font-semibold hover:bg-amber-100 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !loadError && projects.length === 0 && tasks.length === 0 && (
        <div
          role="status"
          className="flex items-center justify-center space-x-2 py-24 text-xs text-[#666666]"
        >
          <Loader2 className="w-4 h-4 animate-spin text-[#74D96F]" />
          <span>Loading projects and tasks...</span>
        </div>
      )}

      {!isLoading && !loadError && (
        <>
          {/* Project Selector Chips */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedProjectId("all")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition shrink-0 ${
                selectedProjectId === "all"
                  ? "bg-[#74D96F] text-[#262626] font-bold shadow-xs border border-[#62CE5C]"
                  : "bg-white border border-[#EDEDED] text-[#666666] hover:text-[#262626] hover:border-[#BEBEBE]"
              }`}
            >
              All Projects ({tasks.length})
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition shrink-0 flex items-center space-x-2 ${
                  selectedProjectId === p.id
                    ? "bg-[#74D96F] text-[#262626] font-bold shadow-xs border border-[#62CE5C]"
                    : "bg-white border border-[#EDEDED] text-[#666666] hover:text-[#262626] hover:border-[#BEBEBE]"
                }`}
              >
                <span>{p.name}</span>
                <span className="text-[10px] opacity-75 font-mono">{progressFor(p.id)}%</span>
              </button>
            ))}
          </div>

          {projects.length === 0 && (
            <div className="rounded-3xl border border-dashed border-[#BEBEBE] bg-white p-8 text-center space-y-2">
              <FolderKanban className="w-8 h-8 mx-auto text-[#74D96F] opacity-60" />
              <p className="text-sm font-bold text-[#262626]">No projects yet</p>
              <p className="text-xs text-[#666666]">
                Create your first project to group tasks. Tasks can also exist without a project.
              </p>
              <button
                onClick={() => {
                  setProjectFormError(null);
                  setIsProjectModalOpen(true);
                }}
                className="mt-1 px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold shadow-sm transition"
              >
                + New Project
              </button>
            </div>
          )}

          {/* Selected project summary */}
          {selectedProject && (
            <div className="rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 shadow-xs space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#666666]">
                <span className="text-sm font-bold text-[#262626]">{selectedProject.name}</span>
                <span className="px-2 py-0.5 rounded-full bg-[#EDEDED] text-[#262626] font-bold uppercase text-[9px]">
                  {selectedProject.status}
                </span>
                {selectedProject.ownerName && selectedProject.ownerName !== "Unknown" && (
                  <span className="flex items-center space-x-1">
                    <User className="w-3 h-3 text-[#74D96F]" />
                    <span>{selectedProject.ownerName}</span>
                  </span>
                )}
                {selectedProject.departmentName && <span>{selectedProject.departmentName}</span>}
                <span className="flex items-center space-x-1">
                  <Calendar className="w-3 h-3 text-[#74D96F]" />
                  <span>{formatDate(selectedProject.dueDate) ?? "No due date"}</span>
                </span>
                <span className="font-mono">
                  {projectStats.get(selectedProject.id)?.done ?? 0}/{projectStats.get(selectedProject.id)?.total ?? 0} done
                </span>
              </div>
              {selectedProject.description && (
                <p className="text-xs text-[#666666] leading-relaxed">{selectedProject.description}</p>
              )}
            </div>
          )}

          {tasks.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[#BEBEBE] bg-white px-4 py-3 text-center text-xs text-[#666666]">
              No tasks yet. Use “New Task” to add one to the board.
            </div>
          )}

          {/* Kanban Board Columns */}
          <div className="flex md:grid md:grid-cols-3 lg:grid-cols-5 gap-4 items-start overflow-x-auto pb-4 snap-x snap-mandatory -mx-3 px-3 sm:mx-0 sm:px-0">
            {columns.map((col) => {
              const colTasks = filteredTasks.filter((t) => t.status === col.id);
              return (
                <div
                  key={col.id}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTargetStatus(col.id);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setDropTargetStatus(null);
                  }}
                  onDrop={(event) => handleTaskDrop(event, col.id)}
                  aria-label={`Move a task to ${col.title}`}
                  className={`w-[85vw] sm:w-[320px] md:w-auto shrink-0 snap-center rounded-2xl border ${col.color} p-3.5 flex flex-col min-h-[480px] shadow-xs transition-shadow ${
                    dropTargetStatus === col.id ? "ring-2 ring-[#74D96F] ring-offset-2 shadow-md" : ""
                  }`}
                >
                  {/* Column Header */}
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#EDEDED]">
                    <span className="text-xs font-bold text-[#262626]">{col.title}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${col.badge}`}>
                      {colTasks.length}
                    </span>
                  </div>

                  {/* Task Cards */}
                  <div className="space-y-3 flex-1 overflow-y-auto">
                    {colTasks.map((task) => {
                      const isPending = pendingTaskIds.has(task.id);
                      const due = formatDate(task.dueDate);
                      const isHighlighted = highlightedTaskId === task.id;
                      return (
                        <div
                          key={task.id}
                          id={`task-card-${task.id}`}
                          aria-busy={isPending}
                          draggable={!isPending}
                          onDragStart={(event) => handleTaskDragStart(event, task)}
                          onDragEnd={finishTaskDrag}
                          title={isPending ? "Status update in progress" : "Drag to move this task to another lane"}
                          className={`rounded-2xl border bg-white p-3.5 shadow-xs hover:border-[#74D96F] hover:shadow-md transition space-y-2.5 group ${
                            isHighlighted
                              ? "border-[#74D96F] ring-2 ring-[#74D96F]/60 bg-[#74D96F]/5 shadow-sm"
                              : "border-[#EDEDED]"
                          } ${isPending ? "opacity-70" : "cursor-grab active:cursor-grabbing"} ${
                            draggedTaskId === task.id ? "opacity-45 scale-[0.98]" : ""
                          }`}
                        >
                          {/* Priority & Project Badge */}
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                task.priority === "urgent"
                                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                                  : task.priority === "high"
                                  ? "bg-amber-100 text-amber-900 border border-amber-200"
                                  : "bg-[#EDEDED] text-[#262626] border border-[#BEBEBE]/60"
                              }`}
                            >
                              {task.priority}
                            </span>
                            <span className="text-[10px] text-[#666666] font-medium truncate max-w-[110px]">
                              {task.projectName || "No project"}
                            </span>
                          </div>

                          {/* Title & Description */}
                          <div>
                            <h4 className="text-xs font-bold text-[#262626] group-hover:text-black transition">
                              {task.title}
                            </h4>
                            {task.description && (
                              <p className="text-[11px] text-[#666666] mt-1 line-clamp-2 leading-relaxed">
                                {task.description}
                              </p>
                            )}
                          </div>

                          {/* Subtasks Count if any */}
                          {task.subtasks && task.subtasks.length > 0 && (
                            <div className="flex items-center space-x-1 text-[10px] text-[#666666] font-mono">
                              <CheckSquare className="w-3 h-3 text-[#74D96F]" />
                              <span>
                                {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length} subtasks
                              </span>
                            </div>
                          )}

                          {due && (
                            <div className="flex items-center space-x-1 text-[10px] text-[#666666]">
                              <Calendar className="w-3 h-3 text-[#74D96F]" />
                              <span>Due {due}</span>
                            </div>
                          )}

                          {/* Card Footer: Assignee & Quick Status Shift */}
                          <div className="flex items-center justify-between pt-2 border-t border-[#EDEDED] text-[11px] text-[#666666]">
                            <div className="flex items-center space-x-1.5 truncate">
                              <User className="w-3.5 h-3.5 text-[#666666] shrink-0" />
                              <span className="truncate text-[#262626] font-medium text-[10px]">
                                {task.assigneeName || (task.primaryAssigneeId ? "Assigned" : "Unassigned")}
                              </span>
                            </div>

                            <div className="flex items-center space-x-1.5">
                              {isPending && <Loader2 className="w-3 h-3 animate-spin text-[#74D96F]" />}
                              <select
                                value={task.status}
                                disabled={isPending}
                                aria-label={`Status for ${task.title}`}
                                onChange={(e) => void handleStatusChange(task.id, e.target.value as Task["status"])}
                                className="text-[9px] bg-[#EDEDED] border border-[#BEBEBE]/50 rounded-lg px-2 py-0.5 text-[#262626] font-medium focus:outline-none focus:border-[#74D96F] cursor-pointer disabled:cursor-wait disabled:opacity-60"
                              >
                                <option value="open">Open</option>
                                <option value="in_progress">In Progress</option>
                                <option value="in_review">In Review</option>
                                <option value="blocked">Blocked</option>
                                <option value="done">Done</option>
                                <option value="cancelled">Cancelled</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {colTasks.length === 0 && (
                      <div className="py-12 text-center text-[11px] text-[#999999]">
                        No tasks in this lane
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {(cancelledCount > 0 || showCancelled) && (
            <button
              onClick={() => setShowCancelled((v) => !v)}
              className="text-[11px] font-semibold text-[#666666] hover:text-[#262626] underline underline-offset-2"
            >
              {showCancelled ? "Hide cancelled tasks" : `Show ${cancelledCount} cancelled ${cancelledCount === 1 ? "task" : "tasks"}`}
            </button>
          )}
        </>
      )}

      {/* Modal: New Task */}
      {isTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreateTask}
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Create Kanban Task</h3>
              <button
                type="button"
                onClick={() => setIsTaskModalOpen(false)}
                aria-label="Close"
                className="text-[#666666] hover:text-[#262626]"
              >
                ✕
              </button>
            </div>

            {taskFormError && (
              <div
                role="alert"
                className="flex items-start space-x-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{taskFormError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Task Title</label>
              <input
                type="text"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="e.g. Integrate pgvector HNSW index tuning"
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Description</label>
              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="Technical details, acceptance criteria, or context..."
                rows={3}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">Project</label>
                <select
                  value={taskProjectId}
                  onChange={(e) => setTaskProjectId(e.target.value)}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">Assignee</label>
                <select
                  value={taskAssigneeUserId}
                  onChange={(e) => setTaskAssigneeUserId(e.target.value)}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                >
                  <option value="">Unassigned</option>
                  {assignableEmployees.map((emp) => (
                    <option key={emp.id} value={emp.userId}>
                      {`${emp.firstName} ${emp.lastName}`.trim() || emp.workEmail}
                      {emp.designation ? ` (${emp.designation})` : ""}
                    </option>
                  ))}
                </select>
                {employeesError ? (
                  <p className="mt-1 text-[10px] text-amber-800">Employee list unavailable.</p>
                ) : assignableEmployees.length === 0 ? (
                  <p className="mt-1 text-[10px] text-[#666666]">No assignable employees yet.</p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">Priority</label>
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value as Task["priority"])}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">Due Date (optional)</label>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={() => setIsTaskModalOpen(false)}
                disabled={isCreatingTask}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreatingTask}
                className="inline-flex items-center space-x-1.5 px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition disabled:opacity-50"
              >
                {isCreatingTask ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Adding...</span>
                  </>
                ) : (
                  <span>Add to Kanban</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: New Project */}
      {isProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreateProject}
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Create New Project</h3>
              <button
                type="button"
                onClick={() => setIsProjectModalOpen(false)}
                aria-label="Close"
                className="text-[#666666] hover:text-[#262626]"
              >
                ✕
              </button>
            </div>

            {projectFormError && (
              <div
                role="alert"
                className="flex items-start space-x-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{projectFormError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Enterprise Vector Ingestion Pipeline"
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Description</label>
              <textarea
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                placeholder="Goal and key deliverables..."
                rows={3}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Status</label>
              <select
                value={projectStatus}
                onChange={(e) => setProjectStatus(e.target.value as Project["status"])}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] capitalize focus:outline-none focus:border-[#74D96F] focus:bg-white"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={() => setIsProjectModalOpen(false)}
                disabled={isCreatingProject}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreatingProject}
                className="inline-flex items-center space-x-1.5 px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition disabled:opacity-50"
              >
                {isCreatingProject ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <span>Create Project</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
