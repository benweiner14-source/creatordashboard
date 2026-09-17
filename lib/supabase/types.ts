export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          niche: string | null;
          youtube_channel_handle: string | null;
          tiktok_handle: string | null;
          instagram_handle: string | null;
          digest_email_opt_in: boolean;
          digest_last_sent_at: string | null;
          warroom_email_opt_in: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          niche?: string | null;
          youtube_channel_handle?: string | null;
          tiktok_handle?: string | null;
          instagram_handle?: string | null;
          digest_email_opt_in?: boolean;
          digest_last_sent_at?: string | null;
          warroom_email_opt_in?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      diagnostics: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          input_url: string;
          status: 'pending' | 'complete' | 'failed';
          hook_strength_score: number | null;
          retention_risk_score: number | null;
          timing_score: number | null;
          format_fit_score: number | null;
          reach_score: number | null;
          overall_score: number | null;
          report_json: unknown | null;
          error_message: string | null;
          created_at: string;
          visual_audio_status: 'pending' | 'complete' | 'failed' | null;
          visual_audio_narrative: string | null;
          visual_audio_error: string | null;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          input_url: string;
          status?: 'pending' | 'complete' | 'failed';
          hook_strength_score?: number | null;
          retention_risk_score?: number | null;
          timing_score?: number | null;
          format_fit_score?: number | null;
          reach_score?: number | null;
          overall_score?: number | null;
          report_json?: unknown | null;
          error_message?: string | null;
          created_at?: string;
          visual_audio_status?: 'pending' | 'complete' | 'failed' | null;
          visual_audio_narrative?: string | null;
          visual_audio_error?: string | null;
        };
        Update: Partial<Database['public']['Tables']['diagnostics']['Insert']>;
        Relationships: [];
      };
      rate_limit_events: {
        Row: { id: string; profile_id: string | null; ip_hash: string; event_type: string; created_at: string };
        Insert: { id?: string; profile_id?: string | null; ip_hash: string; event_type: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['rate_limit_events']['Insert']>;
        Relationships: [];
      };
      glossary_terms: {
        Row: { id: string; slug: string; term: string; definition: string; example: string; created_at: string };
        Insert: { id?: string; slug: string; term: string; definition: string; example: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['glossary_terms']['Insert']>;
        Relationships: [];
      };
      weekly_digests: {
        Row: { id: string; profile_id: string; week_start: string; content_ideas: unknown | null; sent_at: string | null; created_at: string };
        Insert: { id?: string; profile_id: string; week_start: string; content_ideas?: unknown | null; sent_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['weekly_digests']['Insert']>;
        Relationships: [];
      };
      niche_community_sources: {
        Row: { id: string; niche: string; source_type: string; source_identifier: string; last_scraped_at: string | null; created_at: string };
        Insert: { id?: string; niche: string; source_type: string; source_identifier: string; last_scraped_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['niche_community_sources']['Insert']>;
        Relationships: [];
      };
      recap_cards: {
        Row: {
          id: string;
          profile_id: string;
          month: string;
          platform_data: unknown;
          totals: unknown;
          top_post: unknown;
          warnings: string[];
          generated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          month: string;
          platform_data: unknown;
          totals: unknown;
          top_post: unknown;
          warnings?: string[];
          generated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['recap_cards']['Insert']>;
        Relationships: [];
      };
      platform_connections: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'tiktok' | 'instagram';
          provider_user_id: string;
          access_token_encrypted: string;
          refresh_token_encrypted: string | null;
          expires_at: string | null;
          scopes: string[];
          connected_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'tiktok' | 'instagram';
          provider_user_id: string;
          access_token_encrypted: string;
          refresh_token_encrypted?: string | null;
          expires_at?: string | null;
          scopes?: string[];
          connected_at?: string;
        };
        Update: Partial<Database['public']['Tables']['platform_connections']['Insert']>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          profile_id: string;
          stripe_customer_id: string;
          stripe_subscription_id: string | null;
          status: 'active' | 'past_due' | 'canceled' | 'incomplete';
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          stripe_customer_id: string;
          stripe_subscription_id?: string | null;
          status: 'active' | 'past_due' | 'canceled' | 'incomplete';
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['subscriptions']['Insert']>;
        Relationships: [];
      };
      strategy_breakdowns: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          channel_handle: string;
          channel_url: string;
          post_count: number;
          cadence: unknown;
          format_mix: unknown;
          top_posts: unknown;
          headline: string;
          explanation: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          channel_handle: string;
          channel_url: string;
          post_count: number;
          cadence: unknown;
          format_mix: unknown;
          top_posts: unknown;
          headline: string;
          explanation: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['strategy_breakdowns']['Insert']>;
        Relationships: [];
      };
      linkedin_strategies: {
        Row: {
          id: string;
          profile_id: string;
          niche: string;
          target_goal: string;
          content_pillars: unknown;
          posting_cadence_recommendation: string;
          positioning_notes: string;
          headline: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          niche: string;
          target_goal: string;
          content_pillars: unknown;
          posting_cadence_recommendation: string;
          positioning_notes: string;
          headline: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['linkedin_strategies']['Insert']>;
        Relationships: [];
      };
      linkedin_post_ideas: {
        Row: {
          id: string;
          profile_id: string;
          strategy_id: string;
          week_start: string;
          post_ideas: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          strategy_id: string;
          week_start: string;
          post_ideas: unknown;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['linkedin_post_ideas']['Insert']>;
        Relationships: [];
      };
      linkedin_profile_audits: {
        Row: {
          id: string;
          profile_id: string;
          headline: string;
          working_well: unknown;
          needs_work: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          headline: string;
          working_well: unknown;
          needs_work: unknown;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['linkedin_profile_audits']['Insert']>;
        Relationships: [];
      };
      watchlist_entries: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          handle: string;
          url: string;
          label: string | null;
          last_error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          handle: string;
          url: string;
          label?: string | null;
          last_error?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['watchlist_entries']['Insert']>;
        Relationships: [];
      };
      watchlist_snapshots: {
        Row: {
          id: string;
          entry_id: string;
          captured_at: string;
          subscriber_count: number | null;
          total_view_count: number;
          video_count: number;
          top_posts: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          entry_id: string;
          captured_at?: string;
          subscriber_count?: number | null;
          total_view_count: number;
          video_count: number;
          top_posts: unknown;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['watchlist_snapshots']['Insert']>;
        Relationships: [];
      };
      warroom_alerts: {
        Row: {
          id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          external_post_id: string;
          url: string;
          caption_or_title: string;
          view_count: number;
          engagement_count: number;
          published_at: string;
          severity: string;
          detected_at: string;
        };
        Insert: {
          id?: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          external_post_id: string;
          url: string;
          caption_or_title: string;
          view_count: number;
          engagement_count: number;
          published_at: string;
          severity: string;
          detected_at?: string;
        };
        Update: {
          id?: string;
          platform?: 'youtube' | 'tiktok' | 'instagram';
          external_post_id?: string;
          url?: string;
          caption_or_title?: string;
          view_count?: number;
          engagement_count?: number;
          published_at?: string;
          severity?: string;
          detected_at?: string;
        };
        Relationships: [];
      };
      warroom_settings: {
        Row: { id: boolean; paused: boolean; paused_reason: string | null; paused_at: string | null };
        Insert: { id?: boolean; paused?: boolean; paused_reason?: string | null; paused_at?: string | null };
        Update: { id?: boolean; paused?: boolean; paused_reason?: string | null; paused_at?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      check_and_record_rate_limit: {
        Args: {
          p_profile_id: string | null;
          p_identity_hash: string | null;
          p_ip_hash: string;
          p_event_type: string;
          p_profile_limit: number;
          p_ip_limit: number;
          p_window_start: string;
          p_now: string;
        };
        Returns: { allowed: boolean; reason: string | null; event_id: string | null }[];
      };
      release_rate_limit_event: {
        Args: { p_event_id: string };
        Returns: undefined;
      };
    };
  };
}
