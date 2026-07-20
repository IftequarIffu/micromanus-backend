import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import { notImplemented } from "../middleware/error.ts";

/**
 * Chat routes. Creating a chat is POST /chats (AGENTS.md §7 decision 4;
 * not GET /chats/new).
 */
export const chatsRouter = Router();

chatsRouter.use(requireAuth);

chatsRouter.post("/chats", notImplemented);
chatsRouter.get("/chats/:chatId", notImplemented);
chatsRouter.post("/chats/:chatId/messages", notImplemented);
