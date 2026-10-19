-- Reads KOReader's statistics database and the open document.
-- Everything here is defensive: failures return (nil, message) so the UI can
-- show the real reason instead of silently syncing nothing.
local DataStorage = require("datastorage")
local lfs = require("libs/libkoreader-lfs")

local Stats = {}

local OVERLAP_SECONDS = 24 * 60 * 60 -- re-send a day of history; server dedupes by id

local function dbPath()
    return DataStorage:getSettingsDir() .. "/statistics.sqlite3"
end

local function asString(value)
    if value == nil then return "" end
    return tostring(value)
end

local function trim(value)
    return (asString(value):match("^%s*(.-)%s*$"))
end

-- Same character set the server keeps in cleanId().
local function cleanId(value)
    return (asString(value):gsub("[^%w_%-]", "")):sub(1, 120)
end

local function openDb()
    local path = dbPath()
    if lfs.attributes(path, "mode") ~= "file" then
        return nil, "statistics.sqlite3 not found. Enable Tools > Reading statistics and read a little first."
    end
    local SQ3 = require("lua-ljsqlite3/init")
    local ok, conn = pcall(SQ3.open, path)
    if not ok or not conn then
        return nil, "Cannot open statistics database: " .. tostring(conn)
    end
    return conn
end

-- Returns column-major result table and row count (0 when empty).
local function query(conn, sql)
    local ok, result, count = pcall(conn.exec, conn, sql)
    if not ok then return nil, 0, tostring(result) end
    return result, tonumber(count) or 0
end

--- Flushes the in-memory reading session of the open book into the database.
function Stats.flushCurrentSession(ui)
    local statistics = ui and ui.statistics
    if statistics and statistics.isEnabled and statistics:isEnabled() and statistics.insertDB then
        pcall(function() statistics:insertDB() end)
    elseif statistics and statistics.insertDB and statistics.is_doc then
        pcall(function() statistics:insertDB() end)
    end
end

--- All books known to the statistics plugin.
function Stats.readBooks(conn)
    local base = "SELECT id, title, authors, notes, last_open, highlights, pages, series, language, md5"
    local result, count = query(conn, base .. ", total_read_time, total_read_pages FROM book")
    local has_totals = result ~= nil or count > 0
    if not has_totals then
        result, count = query(conn, base .. ", 0, 0 FROM book")
    end
    local books = {}
    for row = 1, count do
        local md5 = cleanId(result[10][row])
        if md5 ~= "" then
            books[#books + 1] = {
                id = md5,
                title = asString(result[2][row]),
                authors = asString(result[3][row]),
                notes = tonumber(result[4][row]) or 0,
                last_open = tonumber(result[5][row]) or 0,
                highlights = tonumber(result[6][row]) or 0,
                pages = tonumber(result[7][row]) or 0,
                series = asString(result[8][row]),
                language = asString(result[9][row]),
                total_read_time = tonumber(result[11][row]) or 0,
                total_read_pages = tonumber(result[12][row]) or 0,
            }
        end
    end
    return books
end

--- Reading sessions newer than `after` (exclusive), oldest first, at most `limit`.
function Stats.readSessions(conn, after, limit)
    local sql = string.format(
        "SELECT b.md5, p.page, p.start_time, p.duration, %s FROM page_stat_data p "
        .. "JOIN book b ON b.id = p.id_book WHERE p.start_time > %d "
        .. "ORDER BY p.start_time ASC LIMIT %d",
        "p.total_pages", math.floor(after), math.floor(limit))
    local result, count, err = query(conn, sql)
    if not result and count == 0 and err then
        -- very old schema without total_pages
        sql = sql:gsub("p%.total_pages", "0", 1)
        result, count, err = query(conn, sql)
    end
    if err then return nil, err end
    local sessions = {}
    for row = 1, count do
        sessions[#sessions + 1] = {
            book_md5 = cleanId(result[1][row]),
            page = tonumber(result[2][row]) or 0,
            start_time = tonumber(result[3][row]) or 0,
            duration = tonumber(result[4][row]) or 0,
            total_pages = tonumber(result[5][row]) or 0,
        }
    end
    return sessions
end

function Stats.countPending(watermark)
    local conn = openDb()
    if not conn then return nil end
    -- exact count (no overlap window): what is genuinely not uploaded yet
    local result, count = query(conn, "SELECT COUNT(*) FROM page_stat_data WHERE start_time > " .. math.floor(watermark or 0))
    local pending = count > 0 and tonumber(result[1][1]) or nil
    conn:close()
    return pending
end

--- Where a sync run must start reading from.
function Stats.startCursor(watermark)
    return math.max(0, (watermark or 0) - OVERLAP_SECONDS)
end

--- Opens the database for a sync run. Caller must call :close().
function Stats.open()
    return openDb()
end

local function currentPage(ui)
    if ui.paging and ui.paging.current_page then
        return tonumber(ui.paging.current_page) or 0
    end
    local ok, page = pcall(function() return ui.document:getCurrentPage() end)
    if ok and tonumber(page) then return tonumber(page) end
    if ui.view and ui.view.state and ui.view.state.page then
        return tonumber(ui.view.state.page) or 0
    end
    return 0
end

local function totalPages(ui)
    local ok, pages = pcall(function() return ui.document:getPageCount() end)
    if ok and tonumber(pages) then return tonumber(pages) end
    return 0
end

local function splitAuthors(value)
    local authors = {}
    if type(value) == "table" then
        for _, author in ipairs(value) do authors[#authors + 1] = trim(author) end
    else
        for author in asString(value):gmatch("[^,;\n]+") do
            local cleaned = trim(author)
            if cleaned ~= "" then authors[#authors + 1] = cleaned end
        end
    end
    return authors
end

local function bookId(ui, props, filename, known_books)
    local id
    if ui.doc_settings then
        id = ui.doc_settings:readSetting("partial_md5_checksum")
    end
    if (not id or id == "") and filename ~= "" then
        local ok, util = pcall(require, "util")
        if ok and util.partialMD5 then
            local md5_ok, md5 = pcall(util.partialMD5, filename)
            if md5_ok then id = md5 end
        end
    end
    if not id or id == "" then
        for _, book in ipairs(known_books or {}) do
            if book.title == props.title then id = book.id break end
        end
    end
    return cleanId(id or filename)
end

--- Describes the open document, or nil when no book is open.
function Stats.currentBook(ui, known_books)
    local document = ui and ui.document
    if not document then return nil end
    local props = ui.doc_props or (document.getProps and document:getProps()) or {}
    local filename = asString(document.file)
    local title = trim(props.display_title or props.title)
    if title == "" then
        title = filename:match("([^/]+)%.[^./]+$") or filename:match("([^/]+)$") or "Untitled book"
    end
    return {
        id = bookId(ui, props, filename, known_books),
        title = title,
        authors = splitAuthors(props.authors or props.author),
        series = props.series,
        language = props.language,
        currentPage = currentPage(ui),
        totalPages = totalPages(ui),
    }
end

local function highlightPage(ui, item)
    local page = item.pageno or item.page
    if tonumber(page) then return tonumber(page) end
    if type(page) == "string" and ui.document and ui.document.getPageFromXPointer then
        local ok, number = pcall(function() return ui.document:getPageFromXPointer(page) end)
        if ok and tonumber(number) then return tonumber(number) end
    end
    return nil
end

--- Highlights and notes of the open book.
function Stats.highlights(ui)
    local entries = ui and ui.annotation and ui.annotation.annotations
    if type(entries) ~= "table" then
        local doc_settings = ui and ui.doc_settings
        entries = doc_settings and doc_settings:readSetting("annotations")
    end
    local result = {}
    if type(entries) ~= "table" then return result end
    for _, item in ipairs(entries) do
        local text = trim(item.text)
        local note = trim(item.note)
        if text == "" then text = note end -- note-only annotation
        if text ~= "" then
            result[#result + 1] = {
                text = text,
                note = (note ~= "" and note ~= text) and note or nil,
                page = highlightPage(ui, item),
                createdAt = item.datetime,
            }
        end
    end
    return result
end

return Stats
