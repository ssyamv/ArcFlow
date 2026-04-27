<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1
          class="text-2xl"
          style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
        >
          Webhook Jobs
        </h1>
        <p class="mt-1 text-sm" style="color: var(--color-text-quaternary)">
          重试队列、dead 原因和 payload/result
        </p>
      </div>
      <button class="filter-pill" @click="loadJobs">刷新</button>
    </div>

    <div class="flex flex-wrap gap-2 mb-5">
      <span class="filter-label">来源</span>
      <button
        v-for="option in sourceOptions"
        :key="option.value"
        class="filter-pill"
        :class="{ active: sourceFilter === option.value }"
        @click="setFilter('source', option.value)"
      >
        {{ option.label }}
      </button>

      <span class="filter-divider" />

      <span class="filter-label">状态</span>
      <button
        v-for="option in statusOptions"
        :key="option.value"
        class="filter-pill"
        :class="{ active: statusFilter === option.value }"
        @click="setFilter('status', option.value)"
      >
        {{ option.label }}
      </button>

      <span class="filter-divider" />

      <label class="flex items-center gap-2 text-xs" style="color: var(--color-text-quaternary)">
        Action
        <input
          v-model="actionFilter"
          class="filter-input"
          placeholder="code_merge"
          @keydown.enter="loadJobs"
        />
      </label>
      <label class="flex items-center gap-2 text-xs" style="color: var(--color-text-quaternary)">
        Correlation
        <input
          v-model="correlationFilter"
          class="filter-input correlation-input"
          placeholder="plane:..."
          @keydown.enter="loadJobs"
        />
      </label>
    </div>

    <div
      v-if="error"
      class="mb-4 p-3 rounded-md text-sm"
      style="
        background-color: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.2);
        color: var(--color-error-light);
      "
    >
      {{ error }}
    </div>

    <div
      v-if="loading"
      class="text-center py-10 text-sm"
      style="color: var(--color-text-quaternary)"
    >
      加载中...
    </div>

    <div v-else class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
      <section
        class="rounded-lg overflow-hidden"
        style="border: 1px solid var(--color-border-default)"
      >
        <table class="w-full">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border-subtle)">
              <th class="table-header">Job</th>
              <th class="table-header">Source</th>
              <th class="table-header">Action</th>
              <th class="table-header">状态</th>
              <th class="table-header">重试</th>
              <th class="table-header">Correlation</th>
              <th class="table-header">更新时间</th>
              <th class="table-header">错误</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="job in jobs"
              :key="job.id"
              class="table-row cursor-pointer"
              :class="{ selected: selectedJobId === job.id }"
              @click="selectJob(job.id)"
            >
              <td class="table-cell" style="color: var(--color-text-tertiary)">#{{ job.id }}</td>
              <td class="table-cell" style="color: var(--color-text-tertiary)">
                {{ job.source }}
              </td>
              <td class="table-cell">
                <span class="status-pill" style="border-color: var(--color-border-solid)">
                  {{ job.action }}
                </span>
              </td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center gap-1 text-xs"
                  style="font-weight: 510"
                  :style="{ color: jobStatusColor(job.status) }"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full"
                    :style="{ backgroundColor: jobStatusColor(job.status) }"
                  />
                  {{ job.status }}
                </span>
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                {{ job.attempt_count }}/{{ job.max_attempts }}
                <span v-if="job.next_run_at"> · {{ formatTimestamp(job.next_run_at) }}</span>
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                <span class="font-mono text-xs">{{ job.correlation_id ?? "-" }}</span>
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                {{ formatTimestamp(job.updated_at) }}
              </td>
              <td class="table-cell" style="color: var(--color-error-light)">
                {{ job.last_error ?? "-" }}
              </td>
            </tr>
            <tr v-if="jobs.length === 0">
              <td
                colspan="8"
                class="table-cell text-center py-10"
                style="color: var(--color-text-quaternary)"
              >
                暂无 webhook jobs
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <aside
        class="rounded-lg p-5"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div
          class="text-xs uppercase mb-4"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          Job 详情
        </div>
        <div v-if="detailLoading" class="text-sm" style="color: var(--color-text-quaternary)">
          加载中...
        </div>
        <div v-else-if="selectedJob" class="space-y-4">
          <div>
            <div class="field-label">Job</div>
            <div class="field-value">#{{ selectedJob.id }} · {{ selectedJob.event_type }}</div>
          </div>
          <div>
            <div class="field-label">Correlation ID</div>
            <div class="field-value font-mono">{{ selectedJob.correlation_id ?? "-" }}</div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="field-label">状态</div>
              <div class="field-value" :style="{ color: jobStatusColor(selectedJob.status) }">
                {{ selectedJob.status }}
              </div>
            </div>
            <div>
              <div class="field-label">尝试次数</div>
              <div class="field-value">
                {{ selectedJob.attempt_count }}/{{ selectedJob.max_attempts }}
              </div>
            </div>
            <div>
              <div class="field-label">下次重试</div>
              <div class="field-value">{{ formatTimestamp(selectedJob.next_run_at) }}</div>
            </div>
            <div>
              <div class="field-label">更新时间</div>
              <div class="field-value">{{ formatTimestamp(selectedJob.updated_at) }}</div>
            </div>
          </div>
          <div v-if="selectedJob.last_error">
            <div class="field-label">
              {{ selectedJob.status === "dead" ? "Dead 原因" : "最近错误" }}
            </div>
            <div class="error-box">{{ selectedJob.last_error }}</div>
          </div>
          <div>
            <div class="field-label">Payload</div>
            <pre class="json-box">{{ formatJson(selectedJob.payload) }}</pre>
          </div>
          <div>
            <div class="field-label">Result</div>
            <pre class="json-box">{{ formatJson(selectedJob.result) }}</pre>
          </div>
        </div>
        <div v-else class="text-sm" style="color: var(--color-text-quaternary)">
          选择一条 job 查看 payload、result 和重试状态。
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchWebhookJob, fetchWebhookJobs, type WebhookJob } from "../api/workflow";

defineOptions({ name: "WebhookJobs" });

const route = useRoute();
const router = useRouter();

const jobs = ref<WebhookJob[]>([]);
const selectedJob = ref<WebhookJob | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const error = ref("");

const sourceFilter = ref(String(route.query.source ?? ""));
const statusFilter = ref(String(route.query.status ?? ""));
const actionFilter = ref(String(route.query.action ?? ""));
const correlationFilter = ref(String(route.query.correlation_id ?? ""));

const selectedJobId = computed(() => {
  const raw = route.query.job;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(id) && id > 0 ? id : null;
});

const sourceOptions = [
  { value: "", label: "全部" },
  { value: "git", label: "git" },
  { value: "plane", label: "plane" },
  { value: "cicd", label: "cicd" },
  { value: "ibuild", label: "ibuild" },
  { value: "feishu", label: "feishu" },
];

const statusOptions = [
  { value: "", label: "全部" },
  { value: "pending", label: "pending" },
  { value: "running", label: "running" },
  { value: "success", label: "success" },
  { value: "failed", label: "failed" },
  { value: "dead", label: "dead" },
];

function jobStatusColor(status: string) {
  const map: Record<string, string> = {
    pending: "var(--color-accent-violet)",
    running: "var(--color-accent-violet)",
    success: "var(--color-success)",
    failed: "var(--color-error)",
    dead: "var(--color-error)",
  };
  return map[status] ?? "var(--color-text-quaternary)";
}

function formatTimestamp(value: number | null) {
  if (value == null) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (part: number) => String(part).padStart(2, "0");
  return [date.getUTCFullYear(), pad(date.getUTCMonth() + 1), pad(date.getUTCDate())]
    .join("-")
    .concat(
      ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    );
}

function formatJson(value: unknown) {
  if (value == null) return "-";
  return JSON.stringify(value, null, 2);
}

function syncQuery(extra?: Record<string, string | null>) {
  const query: Record<string, string> = {
    ...(sourceFilter.value ? { source: sourceFilter.value } : {}),
    ...(statusFilter.value ? { status: statusFilter.value } : {}),
    ...(actionFilter.value ? { action: actionFilter.value } : {}),
    ...(correlationFilter.value ? { correlation_id: correlationFilter.value } : {}),
    ...(selectedJobId.value ? { job: String(selectedJobId.value) } : {}),
  };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === null || value === "") {
      delete query[key];
    } else {
      query[key] = value;
    }
  }
  void router.replace({ query });
}

function setFilter(kind: "source" | "status", value: string) {
  if (kind === "source") sourceFilter.value = value;
  if (kind === "status") statusFilter.value = value;
  syncQuery({ job: null });
  void loadJobs();
}

function selectJob(id: number) {
  syncQuery({ job: String(id) });
}

async function loadJobs() {
  loading.value = true;
  error.value = "";
  try {
    const result = await fetchWebhookJobs({
      source: sourceFilter.value || undefined,
      status: statusFilter.value || undefined,
      action: actionFilter.value || undefined,
      correlation_id: correlationFilter.value || undefined,
      limit: 50,
    });
    jobs.value = result.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载 webhook jobs 失败";
    jobs.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadSelectedJob(id: number | null) {
  if (!id) {
    selectedJob.value = null;
    return;
  }
  detailLoading.value = true;
  try {
    selectedJob.value = await fetchWebhookJob(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载 webhook job 详情失败";
    selectedJob.value = null;
  } finally {
    detailLoading.value = false;
  }
}

watch([actionFilter, correlationFilter], () => syncQuery({ job: null }));
watch(selectedJobId, (id) => void loadSelectedJob(id), { immediate: true });

onMounted(() => void loadJobs());
</script>

<style scoped>
.filter-label {
  align-self: center;
  margin-right: 8px;
  font-size: 12px;
  font-weight: 510;
  color: var(--color-text-quaternary);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.filter-divider {
  width: 1px;
  height: 20px;
  align-self: center;
  margin: 0 8px;
  background-color: var(--color-border-default);
}
.filter-pill {
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 510;
  border-radius: 9999px;
  border: 1px solid var(--color-border-default);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 120ms ease;
}
.filter-pill:hover,
.filter-pill.active {
  background-color: var(--color-surface-05);
  color: var(--color-text-primary);
}
.filter-input {
  width: 150px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
}
.correlation-input {
  width: 220px;
}
.table-header {
  text-align: left;
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 510;
  color: var(--color-text-quaternary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.table-cell {
  padding: 10px 14px;
  font-size: 13px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.table-row {
  transition: background-color 120ms ease;
}
.table-row:hover,
.table-row.selected {
  background-color: var(--color-surface-03);
}
.field-label {
  font-size: 11px;
  color: var(--color-text-quaternary);
  margin-bottom: 4px;
}
.field-value {
  font-size: 13px;
  color: var(--color-text-secondary);
  word-break: break-word;
}
.json-box,
.error-box {
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  background-color: var(--color-bg-primary);
  color: var(--color-text-secondary);
  font-size: 12px;
  overflow: auto;
  white-space: pre-wrap;
}
.error-box {
  color: var(--color-error-light);
}
.status-pill {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border: 1px solid;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 510;
  color: var(--color-text-secondary);
}
</style>
