import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("../pages/Login.vue"),
      meta: { public: true },
    },
    {
      path: "/oauth/complete",
      name: "oauth-complete",
      component: () => import("../pages/AuthCallback.vue"),
      meta: { public: true },
    },
    {
      path: "/",
      redirect: "/dashboard",
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: () => import("../pages/Dashboard.vue"),
    },
    {
      path: "/workflows",
      name: "workflows",
      component: () => import("../pages/WorkflowList.vue"),
    },
    {
      path: "/workflows/:id",
      name: "workflow-detail",
      component: () => import("../pages/WorkflowDetail.vue"),
    },
    {
      path: "/chat",
      name: "chat",
      component: () => import("../pages/AiChat.vue"),
    },
    {
      path: "/docs",
      name: "docs",
      component: () => import("../pages/Docs.vue"),
    },
    {
      path: "/prd/chat",
      redirect: "/chat",
    },
    {
      path: "/trigger",
      name: "trigger",
      component: () => import("../pages/WorkflowTrigger.vue"),
    },
    {
      path: "/workspace/settings",
      name: "workspace-settings",
      component: () => import("../pages/WorkspaceSettings.vue"),
    },
    {
      path: "/profile",
      name: "profile",
      component: () => import("../pages/Profile.vue"),
    },
    {
      path: "/:pathMatch(.*)*",
      name: "NotFound",
      component: () => import("../pages/NotFound.vue"),
      meta: { public: true },
    },
  ],
});

router.beforeEach((to) => {
  const token = localStorage.getItem("arcflow_token");
  if (!to.meta.public && !token) {
    return { name: "login" };
  }
});

export default router;
