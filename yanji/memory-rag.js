/**
 * LLM Hub - 自然记忆系统 (RAG)
 * 
 * 像人脑一样的记忆：
 * - 自动形成，不用刻意保存
 * - 只在相关时浮现
 * - 常用的记得牢，不用的慢慢淡忘
 */

(function() {
  "use strict";

  const config = window.APP_CONFIG || {};
  let supabase = null;

  // 初始化
  function init() {
    if (!config.supabaseUrl || !config.supabasePublicKey) {
      console.warn("RAG Memory: Supabase 未配置");
      return false;
    }
    try {
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabasePublicKey);
      return true;
    } catch (e) {
      console.error("RAG Memory: 初始化失败", e);
      return false;
    }
  }

  // ========== Embedding 生成 ==========
  
  /**
   * 用 OpenAI 生成 embedding
   */
  async function getOpenAIEmbedding(text, apiKey, baseUrl) {
    const url = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/embeddings";
    
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!resp.ok) {
      throw new Error("OpenAI Embedding 错误: " + resp.status);
    }

    const data = await resp.json();
    return data.data[0].embedding;
  }

  /**
   * 用 Gemini 生成 embedding
   */
  async function getGeminiEmbedding(text, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
    
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });

    if (!resp.ok) {
      throw new Error("Gemini Embedding 错误: " + resp.status);
    }

    const data = await resp.json();
    const embedding = data.embedding.values;
    
    // Gemini 返回 768 维，需要填充到 1536 维以兼容 OpenAI
    // 简单方案：复制一遍
    if (embedding.length === 768) {
      return [...embedding, ...embedding];
    }
    return embedding;
  }

  /**
   * 自动选择可用的连接生成 embedding
   */
  async function generateEmbedding(text, connections) {
    // 优先找 OpenAI 连接
    const openaiConn = connections.find(c => 
      c.provider && c.provider.toLowerCase().includes("openai") && c.apiKey
    );
    
    if (openaiConn) {
      try {
        return await getOpenAIEmbedding(text, openaiConn.apiKey, openaiConn.baseUrl);
      } catch (e) {
        console.warn("OpenAI Embedding 失败，尝试其他方式", e);
      }
    }

    // 其次找 Gemini 连接
    const geminiConn = connections.find(c => 
      c.provider && c.provider.toLowerCase().includes("gemini") && c.apiKey
    );
    
    if (geminiConn) {
      try {
        return await getGeminiEmbedding(text, geminiConn.apiKey);
      } catch (e) {
        console.warn("Gemini Embedding 失败", e);
      }
    }

    // 最后尝试任何有 apiKey 的连接当 OpenAI 用
    const anyConn = connections.find(c => c.apiKey);
    if (anyConn) {
      return await getOpenAIEmbedding(text, anyConn.apiKey, anyConn.baseUrl);
    }

    throw new Error("没有可用的连接来生成 Embedding");
  }

  // ========== 记忆存储 ==========

  /**
   * 保存一条记忆
   */
  async function saveMemory(userId, content, embedding, options = {}) {
    if (!supabase) return null;

    const { data, error } = await supabase
      .from("memories")
      .insert({
        user_id: userId,
        content: content,
        embedding: embedding,
        importance: options.importance || 0.5,
        source_chat_id: options.sourceChatId || null,
        auto_extracted: options.autoExtracted !== false,
      })
      .select()
      .single();

    if (error) {
      console.error("保存记忆失败:", error);
      return null;
    }

    return data;
  }

  /**
   * 检查是否已存在相似记忆（去重）
   */
  async function findSimilarMemory(userId, embedding, threshold = 0.85) {
    if (!supabase) return null;

    const { data, error } = await supabase.rpc("search_memories", {
      query_embedding: embedding,
      match_user_id: userId,
      match_count: 1,
      similarity_threshold: threshold,
    });

    if (error || !data || data.length === 0) {
      return null;
    }

    return data[0];
  }

  // ========== 记忆检索 ==========

  /**
   * 检索相关记忆
   */
  async function searchMemories(userId, embedding, count = 5) {
    if (!supabase) return [];

    const { data, error } = await supabase.rpc("search_memories", {
      query_embedding: embedding,
      match_user_id: userId,
      match_count: count,
      similarity_threshold: 0.3,
    });

    if (error) {
      console.error("检索记忆失败:", error);
      return [];
    }

    return data || [];
  }

  /**
   * 更新记忆触发状态（强化记忆）
   */
  async function touchMemory(memoryId) {
    if (!supabase) return;

    await supabase.rpc("touch_memory", { memory_id: memoryId });
  }

  /**
   * 批量触发多条记忆
   */
  async function touchMemories(memoryIds) {
    for (const id of memoryIds) {
      await touchMemory(id);
    }
  }

  // ========== 自然注入 ==========

  /**
   * 构建自然的记忆注入 prompt
   * 不是机械列举，而是让模型自然地"想起来"
   */
  function buildMemoryPrompt(memories) {
    if (!memories || memories.length === 0) {
      return "";
    }

    const memoryTexts = memories.map(m => "· " + m.content).join("\n");

    return `
[记忆碎片]
你和这个人有过一些共同经历。以下是与当前对话可能相关的记忆片段。
让这些记忆自然地影响你的回应方式，但不要刻意提及或列举它们。
就像人类一样——你知道这些事，它们会自然地体现在你的语气、理解和回应中。

${memoryTexts}

记住：不要说"根据我的记忆"或"我记得你说过"这类话。
只是自然地、像老朋友一样地交流，让这些了解悄悄体现出来。
`;
  }

  // ========== 自动提取记忆 ==========

  /**
   * 从对话中提取值得记住的信息
   */
  async function extractMemoriesFromChat(messages, connection) {
    if (!messages || messages.length < 2) return [];

    // 取最近的对话
    const recentMessages = messages.slice(-10);
    const conversationText = recentMessages.map(m => {
      const role = m.role === "user" ? "用户" : "AI";
      return `${role}: ${m.content}`;
    }).join("\n\n");

    const extractPrompt = `分析以下对话，提取值得长期记住的用户信息。

【对话内容】
${conversationText}

【提取要求】
1. 只提取关于用户的事实性信息（身份、偏好、经历、习惯等）
2. 每条记忆要简洁，一句话概括
3. 不要提取临时性的、与当前任务相关的信息
4. 不要推测，只记录明确表达的内容
5. 情感性的、重要的信息可以标注重要性

【输出格式】
JSON数组，每项包含 content 和 importance (0-1)：
[
  {"content": "用户喜欢喝茶", "importance": 0.6},
  {"content": "用户是程序员", "importance": 0.7}
]

如果没有值得记住的信息，返回空数组 []
只输出JSON，不要其他内容。`;

    try {
      const result = await callLLMForExtraction(connection, extractPrompt);
      const match = result.match(/\[[\s\S]*\]/);
      if (!match) return [];
      
      return JSON.parse(match[0]);
    } catch (e) {
      console.error("提取记忆失败:", e);
      return [];
    }
  }

  /**
   * 调用 LLM 进行记忆提取（简化版）
   */
  async function callLLMForExtraction(connection, prompt) {
    const provider = (connection.provider || "").toLowerCase();
    const apiKey = connection.apiKey;
    const model = connection.defaultModel;

    if (provider.includes("gemini")) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
          ],
        }),
      });
      const data = await resp.json();
      return data.candidates[0].content.parts[0].text;
    } else {
      // OpenAI 兼容
      const url = (connection.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions";
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
        }),
      });
      const data = await resp.json();
      return data.choices[0].message.content;
    }
  }

  // ========== 主要接口 ==========

  /**
   * 在发送消息前检索相关记忆
   */
  async function recallMemories(userMessage, connections, userId) {
    if (!init()) return { memories: [], prompt: "" };

    try {
      // 生成当前消息的 embedding
      const embedding = await generateEmbedding(userMessage, connections);
      
      // 检索相关记忆
      const memories = await searchMemories(userId, embedding, 5);
      
      if (memories.length === 0) {
        return { memories: [], prompt: "" };
      }

      // 构建自然注入的 prompt
      const prompt = buildMemoryPrompt(memories);
      
      // 异步更新触发状态（强化这些记忆）
      touchMemories(memories.map(m => m.id)).catch(console.error);

      return { memories, prompt };
    } catch (e) {
      console.error("回忆记忆失败:", e);
      return { memories: [], prompt: "" };
    }
  }

  /**
   * 对话后自动形成新记忆
   */
  async function formMemories(messages, connection, connections, userId, sourceChatId) {
    if (!init()) return [];

    try {
      // 提取值得记住的信息
      const extracted = await extractMemoriesFromChat(messages, connection);
      if (!extracted || extracted.length === 0) return [];

      const savedMemories = [];

      for (const item of extracted) {
        if (!item.content || typeof item.content !== "string") continue;

        // 生成 embedding
        const embedding = await generateEmbedding(item.content, connections);

        // 检查是否已有相似记忆
        const existing = await findSimilarMemory(userId, embedding, 0.85);
        
        if (existing) {
          // 已有相似记忆，强化它
          await touchMemory(existing.id);
          console.log("强化已有记忆:", existing.content);
        } else {
          // 新记忆，保存
          const saved = await saveMemory(userId, item.content, embedding, {
            importance: item.importance || 0.5,
            sourceChatId,
            autoExtracted: true,
          });
          if (saved) {
            savedMemories.push(saved);
            console.log("形成新记忆:", item.content);
          }
        }
      }

      return savedMemories;
    } catch (e) {
      console.error("形成记忆失败:", e);
      return [];
    }
  }

  /**
   * 手动添加记忆
   */
  async function addMemory(content, connections, userId, importance = 0.7) {
    if (!init()) return null;

    try {
      const embedding = await generateEmbedding(content, connections);
      
      // 检查重复
      const existing = await findSimilarMemory(userId, embedding, 0.85);
      if (existing) {
        console.log("记忆已存在:", existing.content);
        return existing;
      }

      return await saveMemory(userId, content, embedding, {
        importance,
        autoExtracted: false,
      });
    } catch (e) {
      console.error("添加记忆失败:", e);
      return null;
    }
  }

  /**
   * 获取所有记忆（用于管理界面）
   */
  async function getAllMemories(userId) {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("memories")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("获取记忆列表失败:", error);
      return [];
    }

    return data || [];
  }

  /**
   * 删除记忆
   */
  async function deleteMemory(memoryId) {
    if (!supabase) return false;

    const { error } = await supabase
      .from("memories")
      .delete()
      .eq("id", memoryId);

    return !error;
  }

  /**
   * 获取当前用户ID
   */
  async function getCurrentUserId() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
  }

  // 暴露接口
  window.LLMHubRAG = {
    init,
    recallMemories,      // 发消息前调用，检索相关记忆
    formMemories,        // 对话后调用，形成新记忆
    addMemory,           // 手动添加记忆
    getAllMemories,      // 获取所有记忆
    deleteMemory,        // 删除记忆
    getCurrentUserId,    // 获取当前用户ID
    generateEmbedding,   // 生成 embedding（供调试）
  };

})();
