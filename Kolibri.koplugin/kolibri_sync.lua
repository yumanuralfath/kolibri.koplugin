-- Sync engine: decides *when* to sync (triggers, throttling, network checks)
-- and *how* (incremental, chunked uploads that never block the UI for long).
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local Client = require("kolibri_client")
local Stats = require("kolibri_stats")
local _ = require("gettext")

local Sync = {
    running = false,
    running_since = 0,
    dirty = false,         -- something is waiting to be uploaded
    activity = false,      -- pages were turned since the last sync
    backoff_until = 0,
    progress = nil,        -- InfoMessage shown during manual syncs
}

local STALE_AFTER = 180    -- a "running" flag older than this is a leftover and gets ignored
local AUTO_FLAG = {
    connect = "sync_on_connect",
    open = "sync_on_open",
    close = "sync_on_close",
    reading = "sync_while_reading",
}

local function networkManager()
    local ok, NetworkMgr = pcall(require, "ui/network/manager")
    if ok then return NetworkMgr end
end

--- True when the device has a network link. We deliberately use link state
-- (isConnected) rather than isOnline: a local server on a LAN without
-- internet access must still sync.
function Sync.isConnected()
    local NetworkMgr = networkManager()
    if not NetworkMgr then return true end
    for _i, method in ipairs({ "isConnected", "isOnline" }) do
        if NetworkMgr[method] then
            local ok, result = pcall(function() return NetworkMgr[method](NetworkMgr) end)
            if ok then return result and true or false end
        end
    end
    return true
end

function Sync.isBusy()
    if Sync.running and os.time() - Sync.running_since > STALE_AFTER then
        Sync.running = false
    end
    return Sync.running
end

local function notify(text, timeout)
    UIManager:show(InfoMessage:new { text = text, timeout = timeout })
end

local function closeProgress()
    if Sync.progress then
        UIManager:close(Sync.progress)
        Sync.progress = nil
    end
end

local function showProgress(text)
    closeProgress()
    Sync.progress = InfoMessage:new { text = text }
    UIManager:show(Sync.progress)
    UIManager:forceRePaint()
end

-- KOReader's JSON encoder writes empty Lua tables as {} — mark lists as arrays.
local function asArray(list)
    local ok, rapidjson = pcall(require, "rapidjson")
    if ok and rapidjson.array then
        local marked_ok, marked = pcall(rapidjson.array, list)
        if marked_ok then return marked end
    end
    return list
end

local function encode(payload)
    local rapidjson = require("rapidjson")
    return rapidjson.encode(payload)
end

local function finish(ctx, ok, message, kind)
    local config = ctx.config
    if ctx.conn then pcall(function() ctx.conn:close() end) ctx.conn = nil end
    Sync.running = false
    closeProgress()
    local duration = os.time() - ctx.started
    config:set("last_attempt", ctx.started)
    if ok then
        Sync.dirty = false
        Sync.activity = false
        Sync.backoff_until = 0
        config:set("last_success", os.time())
        config:set("last_error", "")
        config:set("total_sessions_sent", (config:get("total_sessions_sent") or 0) + ctx.sent)
        config:set("last_summary", {
            sessions = ctx.sent, books = #ctx.books, highlights = #ctx.highlights,
            chunks = ctx.chunks, duration = duration, trigger = ctx.trigger,
        })
    else
        Sync.dirty = true
        Sync.backoff_until = os.time() + ((kind == "auth" or kind == "config") and 600 or 120)
        config:set("last_error", string.format("%s|%s", os.time(), message or "unknown error"))
    end
    config:flush()

    local show = ctx.manual or config:get("notify_auto")
    if show then
        if ok then
            notify(string.format("%s\n%s", _("Kolibri sync complete."),
                string.format(_("%d new sessions · %d books · %d highlights"),
                    ctx.sent, #ctx.books, #ctx.highlights)), 4)
        else
            notify(_("Kolibri sync failed:") .. "\n" .. tostring(message))
        end
    end
    if ctx.on_done then pcall(ctx.on_done, ok, message) end
end

local function step(ctx)
    local ok, err = pcall(function()
        local config = ctx.config
        local sessions, read_error = Stats.readSessions(ctx.conn, ctx.cursor, ctx.batch)
        if not sessions then return finish(ctx, false, read_error) end

        local payload = { stats = asArray(sessions) }
        if ctx.first then
            payload.book = ctx.current
            payload.books = asArray(ctx.books)
            payload.highlights = asArray(ctx.highlights)
        end
        local encoded_ok, body = pcall(encode, payload)
        if not encoded_ok then
            return finish(ctx, false, "Could not encode data: " .. tostring(body))
        end

        local sent, __, message, kind = Client.request({
            server_url = config:get("server_url"),
            password = config:get("password"),
            path = "/api/sync",
            payload = body,
            block_timeout = ctx.fast and 5 or 10,
            total_timeout = ctx.fast and 15 or 60,
        })
        if not sent then return finish(ctx, false, message, kind) end

        ctx.first = false
        ctx.chunks = ctx.chunks + 1
        if #sessions > 0 then
            ctx.sent = ctx.sent + #sessions
            ctx.cursor = sessions[#sessions].start_time
            if ctx.cursor > (config:get("stat_watermark") or 0) then
                config:set("stat_watermark", ctx.cursor)
            end
        end
        if #sessions >= ctx.batch then
            if ctx.manual then
                showProgress(string.format(_("Syncing to Kolibri…\n%d sessions uploaded"), ctx.sent))
            end
            UIManager:scheduleIn(0.05, function() step(ctx) end)
        else
            finish(ctx, true)
        end
    end)
    if not ok then finish(ctx, false, tostring(err)) end
end

function Sync.start(ui, config, trigger, opts)
    opts = opts or {}
    local manual = trigger == "manual"
    Sync.running = true
    Sync.running_since = os.time()

    local ctx = {
        config = config, trigger = trigger, manual = manual, fast = opts.fast,
        on_done = opts.on_done, started = os.time(), first = true,
        sent = 0, chunks = 0, books = {}, highlights = {},
        batch = math.max(100, tonumber(config:get("batch_size")) or 1500),
    }
    if manual then showProgress(_("Syncing to Kolibri…")) end

    local ok, err = pcall(function()
        Stats.flushCurrentSession(ui)
        local conn, open_error = Stats.open()
        if not conn then return finish(ctx, false, open_error, "config") end
        ctx.conn = conn
        ctx.books = Stats.readBooks(conn)
        ctx.current = Stats.currentBook(ui, ctx.books)
        ctx.highlights = ctx.current and Stats.highlights(ui) or {}
        ctx.cursor = Stats.startCursor(config:get("stat_watermark"))
        if not ctx.current and #ctx.books == 0 then
            return finish(ctx, false, _("Nothing to sync yet. Read a book with Reading statistics enabled."), "config")
        end
        UIManager:nextTick(function() step(ctx) end)
    end)
    if not ok then finish(ctx, false, tostring(err)) end
    return true
end

--- Entry point for every trigger.
-- @param trigger "manual" | "connect" | "open" | "close" | "reading"
function Sync.request(ui, config, trigger, opts)
    local manual = trigger == "manual"
    if not config:isConfigured() then
        if manual then notify(_("Set the Kolibri server URL and password first.")) end
        return false, "not_configured"
    end
    if not manual then
        if not config:get("auto_sync") then return false, "disabled" end
        local flag = AUTO_FLAG[trigger]
        if flag and not config:get(flag) then return false, "trigger_disabled" end
    end
    if Sync.isBusy() then
        if manual then notify(_("A sync is already running.")) end
        return false, "busy"
    end
    if not manual then
        local now = os.time()
        local urgent = trigger == "connect" or trigger == "close"
        local floor = trigger == "close" and 0 or (trigger == "connect" and 15 or (tonumber(config:get("interval_minutes")) or 10) * 60)
        if (floor > 0 and now - (config:get("last_attempt") or 0) < floor)
            or (not urgent and now < Sync.backoff_until) then
            Sync.dirty = true
            return false, "throttled"
        end
    end
    if not Sync.isConnected() then
        if manual then
            local NetworkMgr = networkManager()
            local runner = NetworkMgr and (NetworkMgr.runWhenConnected or NetworkMgr.runWhenOnline)
            if runner then
                runner(NetworkMgr, function() Sync.start(ui, config, trigger, opts) end)
                return true
            end
            notify(_("No network connection."))
            return false, "offline"
        end
        Sync.dirty = true -- picked up by onNetworkConnected or the poll timer
        return false, "offline"
    end
    return Sync.start(ui, config, trigger, opts)
end

function Sync.markActivity()
    Sync.activity = true
end

--- True when automatic syncing has something worth uploading.
function Sync.hasPendingWork()
    return Sync.dirty or Sync.activity
end

--- Pings the server; returns ok, message.
function Sync.testConnection(config)
    if not config:isConfigured() then
        return false, _("Set the Kolibri server URL and password first.")
    end
    if not Sync.isConnected() then
        return false, _("No network connection.")
    end
    local ok, message = Client.test(config:get("server_url"), config:get("password"))
    return ok, message
end

return Sync
