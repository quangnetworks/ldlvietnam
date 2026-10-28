-- Tin nhắn 1-1: mỗi cặp người dùng chỉ có một cuộc trò chuyện (trước đây bấm liên tục có thể tạo trùng)
ALTER TABLE chat_channels ADD COLUMN direct_key TEXT;
UPDATE chat_channels SET direct_key = (
  SELECT MIN(m.user_id) || '-' || MAX(m.user_id) FROM chat_members m WHERE m.channel_id = chat_channels.id
) WHERE kind = 'direct';
-- gộp các cuộc trò chuyện trùng vào cuộc tạo sớm nhất
UPDATE chat_messages SET channel_id = (
  SELECT MIN(c2.id) FROM chat_channels c2 WHERE c2.kind = 'direct'
    AND c2.direct_key = (SELECT c1.direct_key FROM chat_channels c1 WHERE c1.id = chat_messages.channel_id)
) WHERE channel_id IN (SELECT id FROM chat_channels WHERE kind = 'direct' AND direct_key IS NOT NULL);
DELETE FROM chat_channels WHERE kind = 'direct' AND direct_key IS NOT NULL
  AND id <> (SELECT MIN(c2.id) FROM chat_channels c2 WHERE c2.kind = 'direct' AND c2.direct_key = chat_channels.direct_key);
UPDATE chat_channels SET last_message_at = (SELECT MAX(x.created_at) FROM chat_messages x WHERE x.channel_id = chat_channels.id)
  WHERE kind = 'direct';
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_direct_key ON chat_channels(direct_key);
