import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
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
      path: "/prd/chat",
      redirect: "/chat",
    },
    {
      path: "/trigger",
      name: "trigger",
      component: () => import("../pages/WorkflowTrigger.vue"),
    },
    {
      path: "/:pathMatch(.*)*",
      name: "NotFound",
      component: () => import("../pages/NotFound.vue"),
    },
  ],
});

export default router;
