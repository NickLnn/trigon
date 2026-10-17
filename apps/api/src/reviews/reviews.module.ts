import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module';
import { ReviewsController } from './reviews.controller';

@Module({ imports: [CommentsModule], controllers: [ReviewsController] })
export class ReviewsModule {}
