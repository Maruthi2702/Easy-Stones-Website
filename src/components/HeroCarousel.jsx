import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocalImagePath } from '../utils/imagePath';
import './HeroCarousel.css';

import { API_URL } from '../config/api';

const HeroCarousel = () => {
    const [sliderProducts, setSliderProducts] = useState([]);

    useEffect(() => {
        const fetchProducts = async () => {
            try {
                const response = await fetch(`${API_URL}/api/products`);
                if (response.ok) {
                    const data = await response.json();
                    const filtered = data.filter(p => p.showInSlider);
                    setSliderProducts(filtered);
                }
            } catch (error) {
                console.error('Error fetching slider products:', error);
            }
        };

        fetchProducts();
    }, []);

    // Fallback slides if no products selected
    const defaultSlides = [
        {
            image: 'Calacatta_Bella.jpg',
            title: 'Moda Quartz',
            subtitle: 'Timeless Elegance for Modern Living'
        },
        {
            image: 'Statuario_Fantasia.jpg',
            title: 'Moda Quartz',
            subtitle: 'Engineered for Perfection'
        }
    ];

    const slides = sliderProducts.length > 0
        ? sliderProducts.map(p => ({
            image: p.image,
            title: p.category,
            subtitle: p.name,
            id: p.id
        }))
        : defaultSlides;

    const [current, setCurrent] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrent((prev) => (prev + 1) % slides.length);
        }, 5000);
        return () => clearInterval(timer);
    }, [slides.length]);

    const nextSlide = () => setCurrent((prev) => (prev + 1) % slides.length);
    const prevSlide = () => setCurrent((prev) => (prev - 1 + slides.length) % slides.length);

    return (
        <section className="hero-carousel">
            {slides.map((slide, index) => (
                <div
                    key={index}
                    className={`carousel-slide ${index === current ? 'active' : ''}`}
                >
                    <div className="slide-image-wrapper">
                        <img
                            src={getLocalImagePath(slide.image)}
                            alt={slide.title}
                            className="slide-image"
                        />
                        <div className="slide-overlay" />
                    </div>
                    <div className="slide-content container">
                        <h1 className="slide-title">
                            <span className="slide-title-main">{slide.title}</span>
                        </h1>
                        <p className="slide-subtitle">{slide.subtitle}</p>

                    </div>
                </div>
            ))}

            <div className="carousel-controls">
                <button className="control-btn prev" onClick={prevSlide} aria-label="Previous slide">
                    <ChevronLeft size={24} />
                </button>
                <button className="control-btn next" onClick={nextSlide} aria-label="Next slide">
                    <ChevronRight size={24} />
                </button>
            </div>

            <div className="carousel-indicators">
                {slides.map((_, index) => (
                    <button
                        key={index}
                        className={`indicator ${index === current ? 'active' : ''}`}
                        onClick={() => setCurrent(index)}
                        aria-label={`Go to slide ${index + 1}`}
                    />
                ))}
            </div>
        </section>
    );
};

export default HeroCarousel;
