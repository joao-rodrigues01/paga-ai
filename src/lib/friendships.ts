import { getSupabaseClient } from './supabase'

export async function createFriendInviteLink(friendshipId: string): Promise<string> {
  const { data: token, error } = await getSupabaseClient().rpc('create_friend_invite', {
    p_friendship_id: friendshipId,
  })
  if (error) throw error

  const inviteUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
  inviteUrl.searchParams.set('invite', token)
  return inviteUrl.toString()
}

export async function acceptFriendInvite(token: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('accept_friend_invite', { p_token: token })
  if (error) throw error
}
